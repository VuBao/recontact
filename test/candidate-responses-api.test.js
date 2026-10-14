import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestPatch, onRequestPost } from "../functions/api/mail/responses.js";
import { onRequestPost as createManualResponse } from "../functions/api/mail/responses/manual.js";

function request(url, options = {}) {
  return new Request(url, { ...options, headers: { "Cf-Access-Jwt-Assertion": "test-jwt", ...options.headers } });
}

test("response sync safely skips when Gmail is not configured", async () => {
  const response = await onRequestPost({ env: { DB: {} }, request: request("https://example.test/api/mail/responses", { method: "POST", body: "{}" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { synced: 0, skipped: true });
});

test("response list returns only candidates with a response", async () => {
  let sql = "";
  const response = await onRequestGet({
    env: { DB: { prepare(statement) { sql = statement; return { async all() { return { results: [{ id: "cand-1", response_status: "PENDING" }] }; } }; } } },
    request: request("https://example.test/api/mail/responses")
  });
  assert.match(sql, /response_status IS NOT NULL/);
  assert.match(sql, /response_note/);
  assert.deepEqual(await response.json(), [{ id: "cand-1", response_status: "PENDING" }]);
});

test("staff can confirm a response and mark it completed", async () => {
  const calls = [];
  const db = { prepare(sql) { return { bind(...params) { return { async run() { calls.push({ sql, params }); return { meta: { changes: 1 } }; } }; } }; } };
  const confirm = await onRequestPatch({ env: { DB: db }, request: request("https://example.test/api/mail/responses", { method: "PATCH", body: JSON.stringify({ candidate_id: "cand-1", status: "CONFIRMED", name: "山田", phone: "090", availability: "平日", start_date: "11月", note: "Đã gọi" }) }) });
  const complete = await onRequestPatch({ env: { DB: db }, request: request("https://example.test/api/mail/responses", { method: "PATCH", body: JSON.stringify({ candidate_id: "cand-1", status: "COMPLETED" }) }) });
  assert.equal(confirm.status, 200);
  assert.equal(complete.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params[4], "CONFIRMED");
  assert.equal(calls[1].params[4], "COMPLETED");
  assert.equal(calls[1].params[5], 0, "completion without a note preserves the existing note");
});

test("manual response confirms an existing candidate and stores a note", async () => {
  const calls = [];
  const db = { prepare(sql) { return { bind(...params) { return { async all() { return { results: sql.startsWith("SELECT") ? [{ id: "cand-1" }] : [] }; }, async run() { calls.push({ sql, params }); return { meta: { changes: 1 } }; } }; } }; } };
  const response = await createManualResponse({ env: { DB: db }, request: request("https://example.test/api/mail/responses/manual", { method: "POST", body: JSON.stringify({ candidate_id: "cand-1", name: "山田", phone: "090", availability: "平日", start_date: "11月", note: "Đã gọi lại" }) }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { created: true, candidate_id: "cand-1", status: "CONFIRMED" });
  assert.match(calls[0].sql, /response_status = 'CONFIRMED'/);
  assert.equal(calls[0].params[4], "Đã gọi lại");
});

test("manual response rejects unknown candidates and notes over 100 characters", async () => {
  const missingDb = { prepare() { return { bind() { return { async all() { return { results: [] }; } }; } }; } };
  const missing = await createManualResponse({ env: { DB: missingDb }, request: request("https://example.test/api/mail/responses/manual", { method: "POST", body: JSON.stringify({ candidate_id: "missing" }) }) });
  assert.equal(missing.status, 404);
  const longNote = await createManualResponse({ env: { DB: missingDb }, request: request("https://example.test/api/mail/responses/manual", { method: "POST", body: JSON.stringify({ candidate_id: "missing", note: "x".repeat(101) }) }) });
  assert.equal(longNote.status, 400);
});
