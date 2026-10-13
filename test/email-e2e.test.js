import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as previewMail } from "../functions/api/mail-preview.js";
import { onRequestPost as sendMail } from "../functions/api/mail-send.js";
import { getBatchDeliveries } from "../functions/lib/mail/batches.js";

class E2EDataStore {
  constructor() {
    this.candidates = [];
    this.batches = [];
    this.deliveries = [];
    this.r2Objects = new Map();
  }

  prepare(sql) {
    const self = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes("FROM email_batches WHERE idempotency_key = ?")) {
              return self.batches.find(b => b.idempotency_key === params[0]) || null;
            }
            throw new Error(`Unhandled first query: ${sql}`);
          },
          async all() {
            if (sql.includes("FROM candidates") && sql.includes("WHERE id IN")) {
              const matched = self.candidates.filter(c => params.includes(c.id));
              return { results: matched };
            }
            if (sql.includes("FROM email_deliveries") && sql.includes("WHERE batch_id = ?")) {
              const matched = self.deliveries.filter(d => d.batch_id === params[0]);
              return { results: matched };
            }
            throw new Error(`Unhandled all query: ${sql}`);
          },
          async run() {
            if (sql.includes("INSERT INTO email_batches")) {
              self.batches.push({
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
              self.deliveries.push({
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
              const d = self.deliveries.find(item => item.id === params[4]);
              if (d) {
                d.status = params[0];
                d.error_message = params[1];
                d.provider_message_id = params[2];
                d.sent_at = params[3];
              }
              return;
            }
            if (sql.includes("UPDATE email_batches")) {
              const b = self.batches.find(item => item.id === params[4]);
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

  clear() {
    this.candidates = [];
    this.batches = [];
    this.deliveries = [];
    this.r2Objects.clear();
  }
}

test("End-to-end dry-run: candidate selection -> preview -> send -> audit -> attachment safety", async () => {
  const store = new E2EDataStore();

  // 1. Seed synthetic candidates with internal example.test addresses
  const cvBytesA = new TextEncoder().encode("%PDF-1.4\nCONFIDENTIAL_CV_BODY_FOR_TANAKA");
  const cvBytesB = new TextEncoder().encode("%PDF-1.4\nCONFIDENTIAL_CV_BODY_FOR_BINH");

  store.r2Objects.set("cv/synth-1/tanaka_cv.pdf", cvBytesA);
  store.r2Objects.set("cv/synth-2/binh_cv.pdf", cvBytesB);

  store.candidates.push(
    {
      id: "synth-1",
      full_name: "Tanaka Kenji (タナカ ケンジ)",
      email: "tanaka@example.test",
      japanese_level: "N1",
      file_key: "cv/synth-1/tanaka_cv.pdf",
      file_name: "tanaka_cv.pdf",
      labels_json: "[]"
    },
    {
      id: "synth-2",
      full_name: "Lê Văn Bình",
      email: "binh@example.test",
      japanese_level: "N2",
      file_key: "cv/synth-2/binh_cv.pdf",
      file_name: "binh_cv.pdf",
      labels_json: "[]"
    }
  );

  const capturedOutbound = [];
  const fakeCaptureProvider = {
    async send(payload) {
      capturedOutbound.push(payload);
      return { id: `msg-e2e-${capturedOutbound.length}` };
    }
  };

  const env = {
    DB: store,
    MAIL_PROVIDER: fakeCaptureProvider,
    CV_BUCKET: {
      async get(key) {
        return store.r2Objects.get(key) || null;
      }
    }
  };

  // 2. Candidate preview step
  const previewReq = new Request("https://example.test/api/mail-preview", {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": "valid-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({
      candidate_ids: ["synth-1", "synth-2"],
      company_name: "Kyoto Hospitality Ltd"
    })
  });

  const previewRes = await previewMail({ env, request: previewReq });
  assert.equal(previewRes.status, 200);
  const previewJson = await previewRes.json();
  assert.equal(previewJson.total, 2);
  assert.equal(previewJson.ready_count, 2);
  assert.equal(previewJson.unresolvable_count, 0);
  assert.match(previewJson.ready[0].subject, /\[Kyoto Hospitality Ltd\]/);
  assert.match(previewJson.ready[0].text, /Tanaka Kenji/);

  // 3. Multipart send with custom job description attachment
  const jobBrochureBytes = new TextEncoder().encode("%PDF-1.4\nOFFICIAL_JOB_BROCHURE_AND_BENEFITS");
  const jobBrochureFile = new File([jobBrochureBytes], "Kyoto_Job_Brochure.pdf", { type: "application/pdf" });

  const sendForm = new FormData();
  sendForm.append("idempotency_key", "e2e-idemp-key-555");
  sendForm.append("company_name", "Kyoto Hospitality Ltd");
  sendForm.append("candidate_ids", JSON.stringify(["synth-1", "synth-2"]));
  sendForm.append("attachments", jobBrochureFile);

  const sendReq = new Request("https://example.test/api/mail-send", {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": "valid-jwt" },
    body: sendForm
  });

  const sendRes = await sendMail({ env, request: sendReq });
  assert.equal(sendRes.status, 200);
  const sendJson = await sendRes.json();
  assert.equal(sendJson.status, "COMPLETED");
  assert.equal(sendJson.total, 2);
  assert.equal(sendJson.sent, 2);
  assert.equal(sendJson.failed, 0);

  // 4. Verify captured outbound emails
  assert.equal(capturedOutbound.length, 2);

  // Verify each recipient has a single, isolated To header
  assert.equal(capturedOutbound[0].to, "tanaka@example.test");
  assert.equal(capturedOutbound[1].to, "binh@example.test");

  // CRITICAL AUDIT: Verify NO candidate CV bytes appear in outbound attachments!
  for (const outbound of capturedOutbound) {
    assert.equal(outbound.attachments.length, 1);
    assert.equal(outbound.attachments[0].filename, "Kyoto_Job_Brochure.pdf");

    const attachmentString = new TextDecoder().decode(outbound.attachments[0].bytes);
    assert.match(attachmentString, /OFFICIAL_JOB_BROCHURE_AND_BENEFITS/);
    assert.doesNotMatch(attachmentString, /CONFIDENTIAL_CV_BODY/);
  }

  // 5. Verify D1 audit records
  const batch = store.batches.find(b => b.idempotency_key === "e2e-idemp-key-555");
  assert.ok(batch);
  assert.equal(batch.status, "COMPLETED");
  assert.equal(batch.sent_count, 2);

  const deliveries = await getBatchDeliveries(store, batch.id);
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every(d => d.status === "SENT"));
  assert.ok(deliveries.every(d => d.provider_message_id.startsWith("msg-e2e-")));

  // 6. Idempotent replay: Resending with the same idempotency key
  const replayReq = new Request("https://example.test/api/mail-send", {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": "valid-jwt" },
    body: sendForm
  });

  const replayRes = await sendMail({ env, request: replayReq });
  assert.equal(replayRes.status, 200);
  const replayJson = await replayRes.json();
  assert.equal(replayJson.batch_id, batch.id);
  // Ensure provider was not called again!
  assert.equal(capturedOutbound.length, 2);

  // 7. Cleanup verification
  store.clear();
  assert.equal(store.candidates.length, 0);
  assert.equal(store.batches.length, 0);
  assert.equal(store.deliveries.length, 0);
  assert.equal(store.r2Objects.size, 0);
});
