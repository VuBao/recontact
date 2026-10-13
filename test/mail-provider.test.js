import assert from "node:assert/strict";
import test from "node:test";

import { MailProviderError } from "../functions/lib/mail/errors.js";
import { createGmailProvider } from "../functions/lib/mail/gmail.js";
import { createMailProvider } from "../functions/lib/mail/provider.js";

const ENV = {
  MAIL_PROVIDER: "gmail",
  MAIL_FROM_EMAIL: "recruit@example.com",
  MAIL_FROM_NAME: "株式会社K-ANH人材紹介",
  GMAIL_CLIENT_ID: "client-id",
  GMAIL_CLIENT_SECRET: "client-secret",
  GMAIL_REFRESH_TOKEN: "refresh-token"
};

const MESSAGE = {
  from: { email: "recruit@example.com", name: "株式会社K-ANH人材紹介" },
  to: { email: "candidate@example.com", name: "山田 太郎" },
  subject: "【株式会社Be Furano】ホテルスタッフ職へのご応募について",
  text: "山田 太郎様\n\n本文です。",
  attachments: []
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("factory rejects missing and unsupported provider configuration", () => {
  assert.throws(
    () => createMailProvider({}),
    error => error instanceof MailProviderError && error.code === "MAIL_PROVIDER_NOT_CONFIGURED" && error.httpStatus === 503
  );
  assert.throws(
    () => createMailProvider({ MAIL_PROVIDER: "smtp" }),
    error => error instanceof MailProviderError && error.code === "MAIL_PROVIDER_UNSUPPORTED" && error.httpStatus === 503
  );
});

test("factory returns only the provider-neutral send contract", () => {
  const provider = createMailProvider(ENV, { fetchImpl: async () => jsonResponse({}) });
  assert.deepEqual(Object.keys(provider), ["send"]);
  assert.equal(typeof provider.send, "function");
});

test("gmail exchanges the refresh token then sends a base64url MIME message", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com")) return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    return jsonResponse({ id: "gmail-message-id" });
  };
  const provider = createGmailProvider(ENV, { fetchImpl });

  assert.deepEqual(await provider.send(MESSAGE), { messageId: "gmail-message-id" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].options.method, "POST");
  const tokenBody = new URLSearchParams(calls[0].options.body);
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(tokenBody.get("client_id"), "client-id");
  assert.equal(tokenBody.get("client_secret"), "client-secret");
  assert.equal(tokenBody.get("refresh_token"), "refresh-token");

  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(calls[1].options.headers.Authorization, "Bearer access-token");
  const { raw } = JSON.parse(calls[1].options.body);
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /From: .*<recruit@example\.com>/);
  assert.match(mime, /To: .*<candidate@example\.com>/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /山田 太郎様/);
});

test("three concurrent first sends share one in-flight OAuth refresh", async () => {
  let tokenRequests = 0;
  let sendRequests = 0;
  let releaseToken;
  const tokenGate = new Promise(resolve => { releaseToken = resolve; });
  const fetchImpl = async url => {
    if (String(url).includes("oauth2.googleapis.com")) {
      tokenRequests += 1;
      await tokenGate;
      return jsonResponse({ access_token: "shared-access-token", expires_in: 3600 });
    }
    sendRequests += 1;
    return jsonResponse({ id: `gmail-message-${sendRequests}` });
  };
  const provider = createGmailProvider(ENV, { fetchImpl });
  const sends = [
    provider.send({ ...MESSAGE, to: { email: "one@example.com", name: "One" } }),
    provider.send({ ...MESSAGE, to: { email: "two@example.com", name: "Two" } }),
    provider.send({ ...MESSAGE, to: { email: "three@example.com", name: "Three" } })
  ];

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(tokenRequests, 1);
  releaseToken();

  const results = await Promise.all(sends);
  assert.equal(tokenRequests, 1);
  assert.equal(sendRequests, 3);
  assert.deepEqual(results.map(result => result.messageId), [
    "gmail-message-1",
    "gmail-message-2",
    "gmail-message-3"
  ]);
});

test("gmail builds a PDF attachment without leaking it outside the MIME payload", async () => {
  let requestBody;
  const fetchImpl = async (url, options) => {
    if (String(url).includes("oauth2.googleapis.com")) return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    requestBody = JSON.parse(options.body);
    return jsonResponse({ id: "with-attachment" });
  };
  const provider = createGmailProvider(ENV, { fetchImpl });
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 test document");

  await provider.send({
    ...MESSAGE,
    attachments: [{ filename: "募集要項.pdf", contentType: "application/pdf", bytes: pdfBytes }]
  });

  const mime = Buffer.from(requestBody.raw, "base64url").toString("utf8");
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /Content-Disposition: attachment/);
  assert.match(mime, /filename=/);
  assert.match(mime, /JVBERi0xLjQgdGVzdCBkb2N1bWVudA==/);
  assert.doesNotMatch(JSON.stringify(requestBody), /access-token|refresh-token/);
});

test("gmail wraps large attachment base64 lines for RFC-compatible MIME", async () => {
  let requestBody;
  const fetchImpl = async (url, options) => {
    if (String(url).includes("oauth2.googleapis.com")) return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    requestBody = JSON.parse(options.body);
    return jsonResponse({ id: "large-attachment" });
  };
  const provider = createGmailProvider(ENV, { fetchImpl });
  const pdfBytes = new TextEncoder().encode(`%PDF-1.4\n${"A".repeat(300)}`);

  await provider.send({
    ...MESSAGE,
    attachments: [{ filename: "document.pdf", contentType: "application/pdf", bytes: pdfBytes }]
  });

  const mime = Buffer.from(requestBody.raw, "base64url").toString("utf8");
  const attachmentBody = mime.match(/Content-Disposition: attachment[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
  assert.ok(attachmentBody);
  assert.ok(attachmentBody.split("\r\n").every(line => line.length <= 76));
});

test("gmail maps OAuth and provider HTTP failures to safe errors", async t => {
  const cases = [
    { name: "OAuth rejection", tokenStatus: 400, expectedCode: "PROVIDER_AUTH_FAILED", expectedStatus: 401 },
    { name: "Gmail unauthorized", sendStatus: 401, expectedCode: "PROVIDER_AUTH_FAILED", expectedStatus: 401 },
    { name: "Gmail rate limit", sendStatus: 429, expectedCode: "PROVIDER_RATE_LIMITED", expectedStatus: 429 },
    { name: "Gmail unavailable", sendStatus: 503, expectedCode: "PROVIDER_UNAVAILABLE", expectedStatus: 503 },
    { name: "Gmail rejected", sendStatus: 400, expectedCode: "PROVIDER_REJECTED", expectedStatus: 400 }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const fetchImpl = async url => {
        if (String(url).includes("oauth2.googleapis.com")) {
          return item.tokenStatus ? jsonResponse({ error: "sensitive-provider-detail" }, item.tokenStatus) : jsonResponse({ access_token: "access-token", expires_in: 3600 });
        }
        return jsonResponse({ error: { message: "sensitive-provider-detail" } }, item.sendStatus);
      };
      const provider = createGmailProvider(ENV, { fetchImpl });

      await assert.rejects(
        () => provider.send(MESSAGE),
        error => {
          assert.ok(error instanceof MailProviderError);
          assert.equal(error.code, item.expectedCode);
          assert.equal(error.httpStatus, item.expectedStatus);
          assert.doesNotMatch(error.message, /sensitive-provider-detail|access-token|refresh-token/);
          return true;
        }
      );
    });
  }
});

test("gmail rejects unsafe address headers and attachment filenames before fetch", async () => {
  let calls = 0;
  const provider = createGmailProvider(ENV, { fetchImpl: async () => { calls += 1; return jsonResponse({}); } });

  await assert.rejects(
    () => provider.send({ ...MESSAGE, subject: "safe\r\nBcc: victim@example.com" }),
    error => error instanceof MailProviderError && error.code === "PROVIDER_REJECTED"
  );
  await assert.rejects(
    () => provider.send({ ...MESSAGE, attachments: [{ filename: "file.pdf\0evil", contentType: "application/pdf", bytes: new Uint8Array([1]) }] }),
    error => error instanceof MailProviderError && error.code === "PROVIDER_REJECTED"
  );
  assert.equal(calls, 0);
});
