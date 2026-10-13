const UNSAFE_HEADER_CHARACTERS = /[\r\n\0]/;

export class EmailTemplateError extends Error {
  constructor(code, field) {
    super(code);
    this.name = "EmailTemplateError";
    this.code = code;
    this.field = field;
  }
}

function normalizedHeaderValue(value, field) {
  if (typeof value !== "string") throw new EmailTemplateError("TEMPLATE_FIELD_INVALID", field);
  if (UNSAFE_HEADER_CHARACTERS.test(value)) throw new EmailTemplateError("HEADER_VALUE_INVALID", field);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new EmailTemplateError("TEMPLATE_FIELD_INVALID", field);
  return normalized;
}

function normalizedJobParagraph(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw new EmailTemplateError("TEMPLATE_FIELD_INVALID", "jobParagraph");
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new EmailTemplateError("TEMPLATE_FIELD_INVALID", "jobParagraph");
  if (normalized.includes("\0")) throw new EmailTemplateError("TEMPLATE_FIELD_INVALID", "jobParagraph");
  return normalized;
}

function roleWithProfessionSuffix(roleTitle) {
  return roleTitle.endsWith("職") ? roleTitle : `${roleTitle}職`;
}

export function renderCandidateEmail({ candidateName, companyName, roleTitle, jobParagraph = null } = {}) {
  const name = normalizedHeaderValue(candidateName, "candidateName");
  const company = normalizedHeaderValue(companyName, "companyName");
  const role = normalizedHeaderValue(roleTitle, "roleTitle");
  const roleWithSuffix = roleWithProfessionSuffix(role);
  const customParagraph = normalizedJobParagraph(jobParagraph);
  const applicationParagraph = customParagraph
    ?? `このたび、「${company}」の${roleWithSuffix}へのご応募書類を受け取り、ご連絡いたしました。`;

  return {
    subject: `【${company}】${roleWithSuffix}へのご応募について`,
    bodyText: `${name}様

初めまして。
株式会社K-ANH人材紹介を担当しております、アインと申します。

${applicationParagraph}

現在も同社への応募をご希望でしたら、下記の項目をご記入のうえ、本メールにご返信いただけますでしょうか。
ご返信を確認後、弊社担当者よりご連絡し、面接までの流れをご案内いたします。

【ご返信いただきたい内容】

・氏名：
・電話番号：
・お電話に出られる曜日・時間帯：
・採用となった場合の入社可能時期：

ご不明な点がございましたら、お気軽にお問い合わせください。
ご返信をお待ちしております。

どうぞよろしくお願いいたします。`
  };
}
