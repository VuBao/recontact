import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("dashboard includes the application OTP login flow", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="auth-dialog"/);
  assert.match(html, /\/api\/auth\/request/);
  assert.match(html, /\/api\/auth\/verify/);
});
