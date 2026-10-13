import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as previewMail } from "../functions/api/mail-preview.js";
import { onRequestPost as sendMail } from "../functions/api/mail-send.js";
import { validateAttachments } from "../functions/lib/mail/attachments.js";
import { MailProviderError } from "../functions/lib/mail/errors.js";
import { MAX_RECIPIENTS, resolveRecipients } from "../functions/lib/mail/recipients.js";
import { authHeaders, FakeMailDB, pdfFile, sendForm } from "./helpers/fake-mail-db.js";

function previewRequest(body, headers = authHeaders({ "Content-Type": "application/json" })) {
  return new Request("https://example.test/api/mail/preview", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function sendRequest(form) {
  return new Request("https://example.test/api/mail/send", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
}

function sendPayload(overrides = {}) {
  return {
    candidate_ids: ["cand-1", "cand-2"],
    company_name: "株式会社Be Furano",
    job_paragraph: null,
    idempotency_key: crypto.randomUUID(),
    ...overrides
  };
}

test("recipient resolution uses open job assignments, preserves order, and explains blocked rows", async () => {
  const db = new FakeMailDB();
  const result = await resolveRecipients(db, [
    "cand-2", "cand-1", "cand-no-email", "cand-bad-email", "cand-no-role", "cand-many-roles"
  ], "株式会社Be Furano");

  assert.equal(result.eligible, 2);
  assert.equal(result.blocked, 4);
  assert.deepEqual(result.items.map(item => item.candidate_id), [
    "cand-2", "cand-1", "cand-no-email", "cand-bad-email", "cand-no-role", "cand-many-roles"
  ]);
  assert.equal(result.items[0].role_title, "フロント");
  assert.equal(result.items[0].subject, "【株式会社Be Furano】フロント職へのご応募について");
  assert.match(result.items[0].body_text, /^山田 太郎様/);
  assert.deepEqual(result.items.slice(2).map(item => item.error_code), [
    "EMAIL_MISSING", "EMAIL_INVALID", "ROLE_MISSING", "ROLE_AMBIGUOUS"
  ]);
  await assert.rejects(
    () => resolveRecipients(db, ["cand-1", "unknown"], "Company"),
    /Unknown candidate IDs/
  );
});

test("recipient resolution enforces the 20-recipient cap after deduplication", async () => {
  const db = new FakeMailDB();
  const ids = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, index) => `candidate-${index}`);
  await assert.rejects(
    () => resolveRecipients(db, ids, "Company"),
    error => error.code === "BATCH_LIMIT_EXCEEDED" && error.status === 400
  );
});

test("preview endpoint matches the UI items/eligible/blocked contract", async () => {
  const db = new FakeMailDB();
  const unauthorized = await previewMail({
    env: { DB: db },
    request: previewRequest({ candidate_ids: ["cand-1"], company_name: "Company" }, { "Content-Type": "application/json" })
  });
  assert.equal(unauthorized.status, 401);

  const response = await previewMail({
    env: { DB: db },
    request: previewRequest({
      candidate_ids: ["cand-1", "cand-no-role"],
      company_name: "Company",
      job_paragraph: "募集内容をご確認いただきありがとうございます。"
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.eligible, 1);
  assert.equal(body.blocked, 1);
  assert.equal(body.items[0].status, "READY");
  assert.match(body.items[0].body_text, /募集内容をご確認/);
  assert.equal(body.items[1].error_code, "ROLE_MISSING");
});

test("attachment validation accepts real PDF signatures and rejects disguised files", async () => {
  const attachments = await validateAttachments([pdfFile("../job details.pdf")]);
  assert.equal(attachments[0].filename, "job details.pdf");
  assert.equal(attachments[0].contentType, "application/pdf");

  const fake = new File(["not a pdf"], "fake.pdf", { type: "application/pdf" });
  await assert.rejects(() => validateAttachments([fake]), /magic bytes/);
  await assert.rejects(
    () => validateAttachments([pdfFile("same.pdf"), pdfFile("same.pdf")]),
    /Duplicate attachment/
  );
});

test("send endpoint accepts UI multipart payload, audits content, and replays idempotently", async () => {
  const db = new FakeMailDB();
  const messages = [];
  const provider = {
    async send(message) {
      messages.push(message);
      return { messageId: `gmail-${messages.length}` };
    }
  };
  const payload = sendPayload({ idempotency_key: "idem-success" });
  const env = {
    DB: db,
    MAIL_PROVIDER: "gmail",
    MAIL_FROM_EMAIL: "recruit@example.test",
    MAIL_FROM_NAME: "K-ANH"
  };

  const response = await sendMail({
    env,
    data: { mailProvider: provider },
    request: sendRequest(sendForm(payload, [pdfFile("company.pdf")]))
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "COMPLETED");
  assert.equal(body.sent, 2);
  assert.equal(body.failed, 0);
  assert.equal(body.results.length, 2);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].to, { email: "an@example.test", name: "Nguyễn Văn An" });
  assert.deepEqual(messages[0].from, { email: "recruit@example.test", name: "K-ANH" });
  assert.equal(messages[0].attachments[0].filename, "company.pdf");
  assert.equal(db.batches[0].provider, "gmail");
  assert.equal(db.deliveries[0].role_title, "ホテルスタッフ");
  assert.match(db.deliveries[0].body_text, /^Nguyễn Văn An様/);

  const replay = await sendMail({
    env,
    data: { mailProvider: provider },
    request: sendRequest(sendForm(payload, [pdfFile("company.pdf")]))
  });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.batch_id, body.batch_id);
  assert.equal(messages.length, 2, "idempotent replay must not contact provider again");

  const conflict = await sendMail({
    env,
    data: { mailProvider: provider },
    request: sendRequest(sendForm({ ...payload, company_name: "Other Company" }, [pdfFile("company.pdf")]))
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error_code, "IDEMPOTENCY_CONFLICT");
});

test("send refuses all recipients when preview contains a blocked candidate", async () => {
  const db = new FakeMailDB();
  let calls = 0;
  const response = await sendMail({
    env: { DB: db, MAIL_PROVIDER: "gmail" },
    data: { mailProvider: { async send() { calls += 1; } } },
    request: sendRequest(sendForm(sendPayload({ candidate_ids: ["cand-1", "cand-no-role"] })))
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error_code, "RECIPIENTS_BLOCKED");
  assert.equal(body.items[1].error_code, "ROLE_MISSING");
  assert.equal(calls, 0);
  assert.equal(db.batches.length, 0);
});

test("send retries provider rate limits and exposes only normalized safe errors", async () => {
  const db = new FakeMailDB();
  let calls = 0;
  const provider = {
    async send(message) {
      calls += 1;
      if (message.to.email === "yamada@example.test") {
        throw new MailProviderError("PROVIDER_RATE_LIMITED", 429);
      }
      return { messageId: "gmail-ok" };
    }
  };
  const response = await sendMail({
    env: {
      DB: db,
      MAIL_PROVIDER: "gmail",
      MAIL_FROM_EMAIL: "recruit@example.test",
      MAIL_FROM_NAME: "K-ANH"
    },
    data: { mailProvider: provider },
    request: sendRequest(sendForm(sendPayload({ idempotency_key: "idem-partial" })))
  });
  assert.equal(response.status, 207);
  const body = await response.json();
  assert.equal(body.status, "PARTIAL_FAILURE");
  assert.equal(body.sent, 1);
  assert.equal(body.failed, 1);
  assert.equal(calls, 4, "one success plus three rate-limited attempts");
  const failed = body.results.find(item => item.status === "FAILED");
  assert.equal(failed.error_code, "PROVIDER_RATE_LIMITED");
  assert.equal(failed.error_message, "Mail provider rate limit exceeded.");
});
