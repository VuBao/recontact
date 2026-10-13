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

test("CV upload requires selecting one role classification from a select box", () => {
  assert.match(html, /<select id="upload-role"[^>]*required>/);
  assert.match(html, /id="upload-role-new"[^>]*hidden>/);
  assert.match(html, /form\.append\('role_title',roleTitle\)/);
  assert.match(html, /Vui lòng chọn phân loại vị trí trước khi tải CV/);
  assert.match(html, /Vui lòng nhập tên vị trí mới trước khi tải CV/);
});

test("role select helpers resolve the chosen job or a freshly typed one", () => {
  const block = html.match(/\/\/ <role-select>([\s\S]*?)\/\/ <\/role-select>/)?.[1];
  assert.ok(block, "missing role-select helper block");
  const { roleTitleKey, matchJobByTitle } = new Function(
    `let jobs=[{id:'job-1',title:'ホテル  スタッフ'},{id:'job-2',title:'Line cook'}];${block}; return { roleTitleKey, matchJobByTitle };`
  )();

  assert.equal(roleTitleKey('  Hotel   Staff \u3000'), 'hotel staff');
  assert.deepEqual(matchJobByTitle('ホテル\u3000スタッフ'), { id: 'job-1', title: 'ホテル  スタッフ' });
  assert.equal(matchJobByTitle('No such role'), undefined);
});

test("uploadFiles keeps the select on the new-role option when every file in the batch fails", () => {
  assert.match(html, /if\(completed\)syncRoleSelection\(roleTitle\)/, "a wholly failed batch must not overwrite the just-typed role name");
});

test("mail dialog includes mobile no-overflow safeguards", () => {
  assert.match(html, /\.mail-dialog\{[^}]*max-width:calc\(100vw - 24px\)/);
  assert.match(html, /@media\(max-width:720px\)[^{]*\{[\s\S]*?\.mail-dialog/);
  assert.match(html, /overflow-wrap:anywhere/);
});

test("dashboard links to the public privacy policy required by OAuth branding", () => {
  assert.match(html, /href="\/privacy\.html"/);
});
