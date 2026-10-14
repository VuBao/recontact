import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("api() never leaks a raw HTML error page (e.g. Cloudflare's 'Worker exceeded resource limits') to the user in production", () => {
  assert.match(
    html,
    /if\(typeof result==='string'&&result\.trim\(\)\.startsWith\('<'\)\)\{\s*if\(\['127\.0\.0\.1','localhost'\]\.includes\(location\.hostname\)\)/,
    "the localhost-only check must guard the silent dev path, not the friendly-message path"
  );
  assert.match(html, /console\.error\('API error \(non-JSON response\):'/, "the raw body must still be logged for debugging");
  assert.match(html, /Máy chủ đang gặp sự cố \(mã lỗi \$\{response\.status\}\)/, "production users must see a short, friendly message instead of raw HTML");
});
