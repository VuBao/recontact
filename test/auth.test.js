import test from "node:test";
import assert from "node:assert/strict";
import { authorized, createChallenge, createSession, verifyChallenge } from "../functions/lib/auth.js";

const env = { APP_AUTH_EMAILS: "1102.vubao@gmail.com,hoangkyanh261095@gmail.com", APP_SESSION_SECRET: "test-secret" };

test("accepts a valid application session cookie", async () => {
  const session = await createSession("1102.vubao@gmail.com", env);
  const request = new Request("https://example.test/api/candidates", { headers: { Cookie: `recontact_session=${encodeURIComponent(session)}` } });
  assert.equal(await authorized(request, env), true);
});

test("rejects a tampered or unknown application session", async () => {
  const request = new Request("https://example.test/api/candidates", { headers: { Cookie: "recontact_session=bad-token" } });
  assert.equal(await authorized(request, env), false);
});

test("keeps accepting Cloudflare Access assertions", async () => {
  assert.equal(await authorized(new Request("https://example.test", { headers: { "Cf-Access-Jwt-Assertion": "jwt" } }), env), true);
});

test("verifies the signed OTP challenge", async () => {
  const challenge = await createChallenge("1102.vubao@gmail.com", "123456", env);
  assert.equal(await verifyChallenge(challenge, "1102.vubao@gmail.com", "123456", env), true);
  assert.equal(await verifyChallenge(challenge, "1102.vubao@gmail.com", "000000", env), false);
});
