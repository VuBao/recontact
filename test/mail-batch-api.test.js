import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatch,
  getBatchByIdempotencyKey,
  getBatchDeliveries,
  insertDeliveries,
  updateDelivery,
  finalizeBatch
} from "../functions/lib/mail/batches.js";
import { resolveRecipients } from "../functions/lib/mail/recipients.js";
import { validateAttachments, isPdfMagicBytes, sanitizeFilename } from "../functions/lib/mail/attachments.js";
import { onRequestPost as previewMail } from "../functions/api/mail-preview.js";
import { onRequestPost as sendMail } from "../functions/api/mail-send.js";

class FakeMailDB {
  constructor() {
    this.candidates = [
      {
        id: "cand-1",
        full_name: "Nguyễn Văn An",
        email: "an.nguyen@example.test",
        japanese_level: "N2",
        labels_json: "[]"
      },
      {
        id: "cand-2",
        full_name: "山田 太郎",
        email: "yamada@example.test",
        japanese_level: "N1",
        labels_json: "[]"
      },
      {
        id: "cand-no-email",
        full_name: "Lê Thị NoMail",
        email: null,
        japanese_level: "N3",
        labels_json: "[]"
      },
      {
        id: "cand-bad-email",
        full_name: "Trần BadMail",
        email: "invalid-email-address",
        japanese_level: "N4",
        labels_json: "[]"
      }
    ];
    this.batches = [];
    this.deliveries = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes("FROM email_batches WHERE idempotency_key = ?")) {
              return db.batches.find(b => b.idempotency_key === params[0]) || null;
            }
            throw new Error(`Unhandled first query: ${sql}`);
          },
          async all() {
            if (sql.includes("FROM candidates") && sql.includes("WHERE id IN")) {
              const matched = db.candidates.filter(c => params.includes(c.id));
              return { results: matched };
            }
            if (sql.includes("FROM email_deliveries") && sql.includes("WHERE batch_id = ?")) {
              const matched = db.deliveries.filter(d => d.batch_id === params[0]);
              return { results: matched };
            }
            throw new Error(`Unhandled all query: ${sql}`);
          },
          async run() {
            if (sql.includes("INSERT INTO email_batches")) {
              db.batches.push({
                id: params[0],
                idempotency_key: params[1],
                company_name: params[2],
                status: "PROCESSING",
                total_count: params[3],
                sent_count: 0,
                failed_count: 0,
                created_at: new Date().toISOString()
              });
              return;
            }
            if (sql.includes("INSERT INTO email_deliveries")) {
              db.deliveries.push({
                id: params[0],
                batch_id: params[1],
                candidate_id: params[2],
                recipient_email: params[3],
                recipient_name: params[4],
                status: "PENDING",
                created_at: new Date().toISOString()
              });
              return;
            }
            if (sql.includes("UPDATE email_deliveries")) {
              const d = db.deliveries.find(item => item.id === params[4]);
              if (d) {
                d.status = params[0];
                d.error_message = params[1];
                d.provider_message_id = params[2];
                d.sent_at = params[3];
              }
              return;
            }
            if (sql.includes("UPDATE email_batches")) {
              const b = db.batches.find(item => item.id === params[4]);
              if (b) {
                b.status = params[0];
                b.sent_count = params[1];
                b.failed_count = params[2];
                b.completed_at = params[3];
              }
              return;
            }
            throw new Error(`Unhandled run query: ${sql}`);
          }
        };
      }
    };
  }

  async batch(statements) {
    for (const stmt of statements) {
      await stmt.run();
    }
  }
}

function validPdfBuffer(text = "Hello PDF") {
  return new TextEncoder().encode(`%PDF-1.4\n${text}`);
}

// -----------------------------------------------------------------------------
// TASK 1: Audit migration and repository helpers
// -----------------------------------------------------------------------------
test("batches repository creates batch, checks idempotency, updates delivery and finalizes counts", async () => {
  const db = new FakeMailDB();
  const batch = await createBatch(db, {
    idempotencyKey: "test-key-1",
    companyName: "Acme Corp",
    totalCount: 2
  });
  assert.equal(batch.status, "PROCESSING");
  assert.equal(batch.total_count, 2);

  const existing = await getBatchByIdempotencyKey(db, "test-key-1");
  assert.ok(existing);
  assert.equal(existing.company_name, "Acme Corp");

  const deliveries = [
    { candidate_id: "cand-1", recipient_email: "an@example.com", recipient_name: "An" },
    { candidate_id: "cand-2", recipient_email: "yamada@example.com", recipient_name: "Yamada" }
  ];
  const inserted = await insertDeliveries(db, batch.id, deliveries);
  assert.equal(inserted.length, 2);

  await updateDelivery(db, inserted[0].id, {
    status: "SENT",
    providerMessageId: "prov-123",
    sentAt: new Date().toISOString()
  });
  await updateDelivery(db, inserted[1].id, {
    status: "FAILED",
    errorMessage: "Temporary network timeout"
  });

  await finalizeBatch(db, batch.id, {
    status: "PARTIAL_FAILURE",
    sentCount: 1,
    failedCount: 1
  });

  const storedBatch = await getBatchByIdempotencyKey(db, "test-key-1");
  assert.equal(storedBatch.status, "PARTIAL_FAILURE");
  assert.equal(storedBatch.sent_count, 1);
  assert.equal(storedBatch.failed_count, 1);

  const storedDeliveries = await getBatchDeliveries(db, batch.id);
  assert.equal(storedDeliveries[0].status, "SENT");
  assert.equal(storedDeliveries[1].status, "FAILED");
});

// -----------------------------------------------------------------------------
// TASK 2: Authoritative recipient resolution and preview
// -----------------------------------------------------------------------------
test("resolveRecipients authoritatively resolves from D1, preserves order, and rejects unknown IDs", async () => {
  const db = new FakeMailDB();
  const { ready, unresolvable } = await resolveRecipients(
    db,
    ["cand-2", "cand-1", "cand-no-email", "cand-bad-email"],
    "Tokyo Tech"
  );

  assert.equal(ready.length, 2);
  assert.equal(ready[0].candidate_id, "cand-2");
  assert.equal(ready[0].name, "山田 太郎");
  assert.equal(ready[0].email, "yamada@example.test");
  assert.match(ready[0].subject, /\[Tokyo Tech\]/);

  assert.equal(ready[1].candidate_id, "cand-1");
  assert.equal(ready[1].name, "Nguyễn Văn An");

  assert.equal(unresolvable.length, 2);
  assert.equal(unresolvable[0].candidate_id, "cand-no-email");
  assert.equal(unresolvable[0].reason, "missing_email");
  assert.equal(unresolvable[1].candidate_id, "cand-bad-email");
  assert.equal(unresolvable[1].reason, "invalid_email");

  // Rejects unknown candidate IDs
  await assert.rejects(
    () => resolveRecipients(db, ["cand-1", "cand-non-existent"], "Tokyo Tech"),
    /Unknown candidate IDs/
  );
});

test("mail-preview endpoint enforces auth, validation and returns preview JSON", async () => {
  const db = new FakeMailDB();

  // Unauthorized request
  const unauth = await previewMail({
    env: { DB: db },
    request: new Request("https://example.test/api/mail-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ["cand-1"], company_name: "Acme" })
    })
  });
  assert.equal(unauth.status, 401);

  // Missing company_name
  const missingCompany = await previewMail({
    env: { DB: db },
    request: new Request("https://example.test/api/mail-preview", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ["cand-1"], company_name: "" })
    })
  });
  assert.equal(missingCompany.status, 400);

  // Valid preview
  const valid = await previewMail({
    env: { DB: db },
    request: new Request("https://example.test/api/mail-preview", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ["cand-1", "cand-no-email"], company_name: "Global Corp" })
    })
  });
  assert.equal(valid.status, 200);
  const data = await valid.json();
  assert.equal(data.ready_count, 1);
  assert.equal(data.unresolvable_count, 1);
  assert.equal(data.ready[0].name, "Nguyễn Văn An");
  assert.equal(data.ready[0].email, "an.nguyen@example.test");
});

// -----------------------------------------------------------------------------
// TASK 3: Validate multipart attachments
// -----------------------------------------------------------------------------
test("validateAttachments validates count, size, extension, MIME, magic bytes, and sanitizes filenames", async () => {
  const validBytes = validPdfBuffer("Page 1");
  const validFile = new File([validBytes], "job_description.pdf", { type: "application/pdf" });

  const passed = await validateAttachments([validFile]);
  assert.equal(passed.length, 1);
  assert.equal(passed[0].filename, "job_description.pdf");
  assert.equal(passed[0].contentType, "application/pdf");
  assert.ok(isPdfMagicBytes(passed[0].bytes));

  // Traversal and dirty filename sanitization
  assert.equal(sanitizeFilename("../../../secret.pdf"), "secret.pdf");
  assert.equal(sanitizeFilename("company/info.pdf"), "info.pdf");

  // Invalid magic bytes
  const fakePdf = new File(["NOT A PDF HEADER"], "fake.pdf", { type: "application/pdf" });
  await assert.rejects(() => validateAttachments([fakePdf]), /magic bytes/);

  // Invalid extension
  const txtFile = new File([validBytes], "notes.txt", { type: "text/plain" });
  await assert.rejects(() => validateAttachments([txtFile]), /must be a PDF/);

  // Duplicate filenames
  const dup1 = new File([validBytes], "doc.pdf", { type: "application/pdf" });
  const dup2 = new File([validBytes], "doc.pdf", { type: "application/pdf" });
  await assert.rejects(() => validateAttachments([dup1, dup2]), /Duplicate attachment/);

  // Over count limit
  const fileArray = [1, 2, 3, 4].map(i => new File([validBytes], `f${i}.pdf`, { type: "application/pdf" }));
  await assert.rejects(() => validateAttachments(fileArray), /Maximum 3 attachments/);
});

// -----------------------------------------------------------------------------
// TASK 4: Idempotent send orchestration
// -----------------------------------------------------------------------------
test("mail-send successfully sends batch, writes audit records, and honors idempotency replay", async () => {
  const db = new FakeMailDB();
  const sentMessages = [];
  const fakeProvider = {
    async send(payload) {
      sentMessages.push(payload);
      return { id: `prov-${sentMessages.length}` };
    }
  };

  const pdfFile = new File([validPdfBuffer("Details")], "offer.pdf", { type: "application/pdf" });
  const form = new FormData();
  form.append("idempotency_key", "idem-uuid-100");
  form.append("company_name", "Sakura Tech");
  form.append("candidate_ids", JSON.stringify(["cand-1", "cand-2"]));
  form.append("attachments", pdfFile);

  const res = await sendMail({
    env: { DB: db, MAIL_PROVIDER: fakeProvider },
    request: new Request("https://example.test/api/mail-send", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt" },
      body: form
    })
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "COMPLETED");
  assert.equal(json.sent, 2);
  assert.equal(json.failed, 0);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].attachments[0].filename, "offer.pdf");

  // Replay identical request with SAME idempotency key
  const replayRes = await sendMail({
    env: { DB: db, MAIL_PROVIDER: fakeProvider },
    request: new Request("https://example.test/api/mail-send", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt" },
      body: form
    })
  });

  assert.equal(replayRes.status, 200);
  const replayJson = await replayRes.json();
  assert.equal(replayJson.batch_id, json.batch_id);
  assert.equal(replayJson.status, "COMPLETED");
  // Crucial: Provider MUST NOT be called again on replay!
  assert.equal(sentMessages.length, 2);

  // Conflicting payload with same idempotency key
  const conflictForm = new FormData();
  conflictForm.append("idempotency_key", "idem-uuid-100");
  conflictForm.append("company_name", "Different Company");
  conflictForm.append("candidate_ids", JSON.stringify(["cand-1"]));
  const conflictRes = await sendMail({
    env: { DB: db, MAIL_PROVIDER: fakeProvider },
    request: new Request("https://example.test/api/mail-send", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt" },
      body: conflictForm
    })
  });
  assert.equal(conflictRes.status, 409);
});

test("mail-send handles partial failure, retries 429/5xx twice, and sanitizes errors", async () => {
  const db = new FakeMailDB();
  let callCount = 0;
  const fakeProvider = {
    async send(payload) {
      callCount++;
      if (payload.to.includes("yamada")) {
        const err = new Error("Bearer secret_tok_12345: Rate limit exceeded 429");
        err.status = 429;
        throw err;
      }
      return { id: "ok-1" };
    }
  };

  const form = new FormData();
  form.append("idempotency_key", "idem-uuid-200");
  form.append("company_name", "Fuji Corp");
  form.append("candidate_ids", JSON.stringify(["cand-1", "cand-2"]));

  const res = await sendMail({
    env: { DB: db, MAIL_PROVIDER: fakeProvider },
    request: new Request("https://example.test/api/mail-send", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "jwt" },
      body: form
    })
  });

  assert.equal(res.status, 207); // 207 Multi-Status for partial failure
  const data = await res.json();
  assert.equal(data.status, "PARTIAL_FAILURE");
  assert.equal(data.sent, 1);
  assert.equal(data.failed, 1);

  // yamada failed after initial + 2 retries = 3 attempts; cand-1 succeeded in 1 attempt -> total 4 calls
  assert.equal(callCount, 4);

  // Verify safe error sanitization: no secrets or bearer tokens
  const failedDelivery = data.deliveries.find(d => d.status === "FAILED");
  assert.ok(failedDelivery);
  assert.doesNotMatch(failedDelivery.error, /secret_tok/);
  assert.match(failedDelivery.error, /Provider rate limit/);
});
