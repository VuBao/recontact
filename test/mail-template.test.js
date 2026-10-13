import assert from "node:assert/strict";
import test from "node:test";

import { renderCandidateEmail } from "../functions/lib/mail/template.js";

const EXPECTED_BODY = `山田 太郎様

初めまして。
株式会社K-ANH人材紹介を担当しております、アインと申します。

このたび、「株式会社Be Furano」のホテルスタッフ職へのご応募書類を受け取り、ご連絡いたしました。

現在も同社への応募をご希望でしたら、下記の項目をご記入のうえ、本メールにご返信いただけますでしょうか。
ご返信を確認後、弊社担当者よりご連絡し、面接までの流れをご案内いたします。

【ご返信いただきたい内容】

・氏名：
・電話番号：
・お電話に出られる曜日・時間帯：
・採用となった場合の入社可能時期：

ご不明な点がございましたら、お気軽にお問い合わせください。
ご返信をお待ちしております。

どうぞよろしくお願いいたします。`;

test("renders the approved Japanese subject and body exactly", () => {
  const result = renderCandidateEmail({
    candidateName: "山田 太郎",
    companyName: "株式会社Be Furano",
    roleTitle: "ホテルスタッフ"
  });

  assert.equal(result.subject, "【株式会社Be Furano】ホテルスタッフ職へのご応募について");
  assert.equal(result.bodyText, EXPECTED_BODY);
});

test("normalizes surrounding whitespace without appending 職 twice", () => {
  const result = renderCandidateEmail({
    candidateName: "  ĐỖ ANH  ",
    companyName: "  株式会社テスト  ",
    roleTitle: "  介護職  "
  });

  assert.equal(result.subject, "【株式会社テスト】介護職へのご応募について");
  assert.match(result.bodyText, /^ĐỖ ANH様/);
  assert.match(result.bodyText, /「株式会社テスト」の介護職へのご応募書類/);
});

test("allows the approved job paragraph to be replaced for a batch", () => {
  const result = renderCandidateEmail({
    candidateName: "山田 太郎",
    companyName: "株式会社Be Furano",
    roleTitle: "ホテルスタッフ",
    jobParagraph: "募集内容をご確認ください。\n面接日は別途ご案内します。"
  });

  assert.match(result.bodyText, /募集内容をご確認ください。\n面接日は別途ご案内します。/);
  assert.doesNotMatch(result.bodyText, /このたび/);
});

test("rejects empty template values", () => {
  for (const [field, values] of [
    ["candidateName", { candidateName: "", companyName: "会社", roleTitle: "職種" }],
    ["companyName", { candidateName: "氏名", companyName: " ", roleTitle: "職種" }],
    ["roleTitle", { candidateName: "氏名", companyName: "会社", roleTitle: "\t" }]
  ]) {
    assert.throws(
      () => renderCandidateEmail(values),
      error => error.code === "TEMPLATE_FIELD_INVALID" && error.field === field
    );
  }
});

test("rejects CR, LF, and NUL in values used in headers", () => {
  for (const unsafe of ["会社\rBcc: victim@example.com", "会社\nBcc: victim@example.com", "会社\0evil"]) {
    assert.throws(
      () => renderCandidateEmail({ candidateName: "氏名", companyName: unsafe, roleTitle: "職種" }),
      error => error.code === "HEADER_VALUE_INVALID"
    );
  }
});
