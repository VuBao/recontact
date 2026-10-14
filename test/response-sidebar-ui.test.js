import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("response sidebar contains the approved statuses and CV action", () => {
  assert.match(html, /class="wrap dashboard-layout"/);
  assert.match(html, /id="response-sidebar"/);
  assert.match(html, /id="response-blocks"/);
  assert.match(html, /id="response-manual-open"/);
  assert.match(html, /Chưa xác nhận/);
  assert.match(html, /Đã xác nhận/);
  assert.match(html, /Hoàn thành/);
  assert.match(html, /Mở CV/);
  assert.match(html, /response_status/);
  assert.match(html, /api\('\/api\/mail\/responses'/);
});

test("response blocks use the requested colors and fixed fields", () => {
  assert.match(html, /response-block\[data-status=PENDING\]\{background:#fff1f0/);
  assert.match(html, /response-block\[data-status=CONFIRMED\]\{background:#ecfdf3/);
  assert.match(html, /response-block\[data-status=COMPLETED\]\{background:#fff8df/);
  for (const label of ["氏名：", "電話番号：", "電話に出られる曜日・時間：", "勤務開始可能日："]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /data-response-field="note" maxlength="100"/);
});

test("manual response modal selects an existing candidate and uses the dedicated endpoint", () => {
  assert.match(html, /id="response-manual-dialog"/);
  assert.match(html, /id="response-manual-search"/);
  assert.match(html, /id="response-manual-candidates"/);
  assert.match(html, /id="response-manual-note" maxlength="100"/);
  assert.match(html, /api\('\/api\/mail\/responses\/manual'/);
});

test("saved responses load before the optional Gmail sync completes", () => {
  const loadFunction = html.match(/async function loadResponseBlocks\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(loadFunction, /method:'POST'/, "listing saved responses must not wait for Gmail sync");
  assert.match(html, /async function syncResponseBlocks\(\)\{[\s\S]*?method:'POST'[\s\S]*?await loadResponseBlocks\(\)/);
  assert.match(html, /loadResponseBlocks\(\);\n?syncResponseBlocks\(\);/);
});
