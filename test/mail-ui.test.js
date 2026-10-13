import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("bulk mail compose controls are present and labelled", () => {
  const requiredIds = [
    "send-selected", "mail-compose-dialog", "mail-company", "mail-job-paragraph",
    "mail-attachments", "mail-recipient-list", "mail-preview-body", "mail-confirm-dialog",
    "mail-result-summary"
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  assert.match(html, /Gửi mail \(<span id="mail-selected-count">0<\/span>\)/);
  assert.match(html, /accept="application\/pdf,\.pdf"/);
});

test("mail helpers count eligible recipients and summarize partial results", () => {
  const block = html.match(/\/\/ <mail-ui>([\s\S]*?)\/\/ <\/mail-ui>/)?.[1];
  assert.ok(block, "missing mail-ui helper block");
  const { selectedEligibleCount, summarizeSendResult } = new Function(
    `${block}; return { selectedEligibleCount, summarizeSendResult };`
  )();

  assert.equal(selectedEligibleCount([{ status: "READY" }, { status: "ROLE_MISSING" }, { status: "READY" }]), 2);
  assert.deepEqual(summarizeSendResult({ sent: 2, failed: 1 }), {
    message: "Đã gửi 2 email, 1 email thất bại.",
    type: "error"
  });
  assert.deepEqual(summarizeSendResult({ sent: 3, failed: 0 }), {
    message: "Đã gửi thành công 3 email.",
    type: "ok"
  });
});

test("compose flow uses documented preview and multipart send endpoints", () => {
  assert.match(html, /api\('\/api\/mail\/preview'/);
  assert.match(html, /api\('\/api\/mail\/send'/);
  assert.match(html, /form\.append\('payload'/);
  assert.match(html, /crypto\.randomUUID\(\)/);
});

test("CV upload requires and submits one role classification", () => {
  assert.match(html, /id="upload-role"[^>]*required/);
  assert.match(html, /form\.append\('role_title',roleTitle\)/);
  assert.match(html, /Vui lòng nhập phân loại vị trí trước khi tải CV/);
});

test("mail dialog includes mobile no-overflow safeguards", () => {
  assert.match(html, /\.mail-dialog\{[^}]*max-width:calc\(100vw - 24px\)/);
  assert.match(html, /@media\(max-width:720px\)[^{]*\{[\s\S]*?\.mail-dialog/);
  assert.match(html, /overflow-wrap:anywhere/);
});
