import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as requestCode } from "../functions/api/auth/request.js";
import { onRequestPost as verifyCode } from "../functions/api/auth/verify.js";

test("OTP request fails safely when app auth is not configured", async () => {
  const response = await requestCode({ request: new Request("https://example.test/api/auth/request", { method: "POST", body: JSON.stringify({ email: "1102.vubao@gmail.com" }) }), env: {} });
  assert.equal(response.status, 503);
});

test("OTP verification rejects a missing challenge", async () => {
  const response = await verifyCode({ request: new Request("https://example.test/api/auth/verify", { method: "POST", body: JSON.stringify({ email: "1102.vubao@gmail.com", otp: "123456" }) }), env: { APP_AUTH_EMAILS: "1102.vubao@gmail.com", APP_SESSION_SECRET: "test-secret" } });
  assert.equal(response.status, 401);
});
