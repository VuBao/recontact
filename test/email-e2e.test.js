import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as previewMail } from "../functions/api/mail/preview.js";
import { onRequestPost as sendMail } from "../functions/api/mail/send.js";
import { authHeaders, FakeMailDB, pdfFile, sendForm } from "./helpers/fake-mail-db.js";

test("Feature 5 preview-to-send flow creates separate messages and attaches only chosen work PDFs", async () => {
  const db = new FakeMailDB();
  const payload = {
    candidate_ids: ["cand-1", "cand-2"],
    company_name: "株式会社Be Furano",
    job_paragraph: null
  };
  const previewResponse = await previewMail({
    env: { DB: db },
    request: new Request("https://example.test/api/mail/preview", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    })
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.eligible, 2);
  assert.equal(preview.blocked, 0);

  const outbound = [];
  const attachment = pdfFile("company-information.pdf", "work information only");
  const sendResponse = await sendMail({
    env: {
      DB: db,
      MAIL_PROVIDER: "gmail",
      MAIL_FROM_EMAIL: "recruit@example.test",
      MAIL_FROM_NAME: "K-ANH"
    },
    data: {
      mailProvider: {
        async send(message) {
          outbound.push(message);
          return { messageId: `message-${outbound.length}` };
        }
      }
    },
    request: new Request("https://example.test/api/mail/send", {
      method: "POST",
      headers: authHeaders(),
      body: sendForm({ ...payload, idempotency_key: "e2e-batch-1" }, [attachment])
    })
  });

  assert.equal(sendResponse.status, 200);
  assert.equal(outbound.length, 2);
  assert.notEqual(outbound[0].to.email, outbound[1].to.email);
  for (const message of outbound) {
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].filename, "company-information.pdf");
    assert.doesNotMatch(message.attachments[0].filename, /cv|resume|履歴書/i);
  }
});

test("nested Pages Function routes export the canonical handlers used by the UI", async () => {
  const nestedPreview = await import("../functions/api/mail/preview.js");
  const nestedSend = await import("../functions/api/mail/send.js");
  assert.equal(nestedPreview.onRequestPost, previewMail);
  assert.equal(nestedSend.onRequestPost, sendMail);
});
