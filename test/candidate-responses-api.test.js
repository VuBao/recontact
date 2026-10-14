import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestPatch, onRequestPost } from "../functions/api/mail/responses.js";

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
  assert.deepEqual(await response.json(), [{ id: "cand-1", response_status: "PENDING" }]);
});

test("staff can confirm a response and mark it completed", async () => {
  const calls = [];
  const db = { prepare(sql) { return { bind(...params) { return { async run() { calls.push({ sql, params }); return { meta: { changes: 1 } }; } }; } }; } };
  const confirm = await onRequestPatch({ env: { DB: db }, request: request("https://example.test/api/mail/responses", { method: "PATCH", body: JSON.stringify({ candidate_id: "cand-1", status: "CONFIRMED", name: "山田", phone: "090", availability: "平日", start_date: "11月" }) }) });
  const complete = await onRequestPatch({ env: { DB: db }, request: request("https://example.test/api/mail/responses", { method: "PATCH", body: JSON.stringify({ candidate_id: "cand-1", status: "COMPLETED" }) }) });
  assert.equal(confirm.status, 200);
  assert.equal(complete.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params[4], "CONFIRMED");
  assert.equal(calls[1].params[4], "COMPLETED");
});
