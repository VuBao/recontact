# Bulk Candidate Email — Technical Specification

**Status:** Ready for implementation planning  
**Date:** 2026-10-12  
**Target:** Recontact on Cloudflare Pages Functions, D1, and R2  
**First provider:** Gmail / Google Workspace shared company account

## 1. Goal

Allow an operator to select qualified CV rows, click **Gửi mail**, review one compose window, attach shared job/company PDF documents, and send one personalized email to each candidate's `email` field.

The first release is a transactional recruiting workflow, not a marketing campaign system. It must stay small, preserve the current dashboard, and make the delivery provider replaceable later.

## 2. Confirmed Product Rules

1. Every recipient receives a separate message. Recipient addresses must never be exposed to other candidates.
2. The company name is entered once for the send batch.
3. The role is resolved separately for each candidate from the CV's existing folder/job classification.
4. A candidate without an email or with zero/multiple active role classifications is blocked before sending and shown with a specific reason.
5. The operator reviews all generated recipients, subjects, and bodies before confirming the send.
6. The operator may edit the job-specific paragraph for this batch; the fixed greeting, recruiter introduction, reply questions, and closing remain locked in v1.
7. Zero or more shared PDF files may be attached. These are job/company documents, never the candidate's CV.
8. Sending uses one shared company mailbox. Gmail or Google Workspace is first; the provider boundary must support a future replacement.
9. No scheduled sends, follow-up sequences, campaign analytics, open tracking, or automatic retry daemon in v1.

## 3. User Flow

1. Operator filters the dashboard and selects one or more candidate rows.
2. **Gửi mail (N)** appears beside the existing delete action.
3. Clicking it calls the preview API with selected candidate IDs and company name.
4. The compose dialog shows:
   - company name, required;
   - shared editable job-specific paragraph;
   - shared PDF attachments;
   - recipient table: candidate, email, resolved role, generated subject, eligibility/error;
   - a per-recipient preview, with previous/next navigation;
   - **Gửi N mail** only when all rows are eligible.
5. Confirmation text: `Gửi N email riêng biệt đến N ứng viên?` with **Gửi** / **Hủy**.
6. The send API returns one result per recipient. The UI reports sent and failed counts and does not re-send successful rows when the same idempotency key is retried.

## 4. Email Contract

### Subject

```text
【<company_name>】<role_title>職へのご応募について
```

Do not append `職` twice when `role_title` already ends in `職`.

### Plain-text body

```text
<candidate_name>様

初めまして。
株式会社K-ANH人材紹介を担当しております、アインと申します。

このたび、「<company_name>」の<role_title>職へのご応募書類を受け取り、ご連絡いたしました。

現在も同社への応募をご希望でしたら、下記の項目をご記入のうえ、本メールにご返信いただけますでしょうか。
ご返信を確認後、弊社担当者よりご連絡し、面接までの流れをご案内いたします。

【ご返信いただきたい内容】

・氏名：
・電話番号：
・お電話に出られる曜日・時間帯：
・採用となった場合の入社可能時期：

ご不明な点がございましたら、お気軽にお問い合わせください。
ご返信をお待ちしております。

どうぞよろしくお願いいたします。
```

`candidate_name`, `company_name`, and `role_title` are escaped and normalized before MIME construction. Header values containing CR, LF, or NUL are rejected.

## 5. Role Classification Source of Truth

Use the existing normalized tables instead of parsing folder names at send time:

- `jobs.title` is the role title, for example `ホテルスタッフ`.
- `job_candidates` assigns a candidate to that role.
- Folder import converts the first folder segment into a job title and creates the assignment.
- Manual file upload requires a selected role title.
- Existing production CVs are backfilled by matching each local PDF's SHA-256 to `candidates.file_hash`; never match by candidate name or filename alone.
- Folder aliases such as dated copies are resolved through an operator-reviewed mapping file. No suffix is stripped automatically.

The preview/send query must resolve exactly one active job per candidate. Existing records that have not been classified are not guessed; they are reported as `ROLE_MISSING`. Multiple active assignments are reported as `ROLE_AMBIGUOUS` until the operator fixes the classification.

This rule turns the user's folder organization into explicit database data and prevents a moved/renamed local folder from silently changing outgoing email.

The one-time backfill defaults to dry-run. Its report shows matched/unmatched/ambiguous counts, and production writes happen only after the operator approves the folder-to-role mapping and explicitly runs the apply command. Generated reports and mapping files containing local paths are not committed.

## 6. API Contracts

### `POST /api/mail/preview`

Request:

```json
{
  "candidate_ids": ["candidate-id"],
  "company_name": "株式会社Be Furano",
  "job_paragraph": null
}
```

Response `200`:

```json
{
  "eligible": 1,
  "blocked": 0,
  "items": [
    {
      "candidate_id": "candidate-id",
      "candidate_name": "山田 太郎",
      "email": "candidate@example.com",
      "role_title": "ホテルスタッフ",
      "subject": "【株式会社Be Furano】ホテルスタッフ職へのご応募について",
      "body_text": "...",
      "status": "READY",
      "error_code": null
    }
  ]
}
```

Validation errors use `400`; missing Access assertion uses `401`; missing binding/configuration uses `503`. Maximum 20 unique candidate IDs per batch.

### `POST /api/mail/send`

`multipart/form-data`:

- `payload`: JSON string containing the preview request plus `idempotency_key`.
- `attachments`: zero to three PDF files.

Limits:

- at most 20 recipients;
- PDF only, validated by extension, declared MIME type, and `%PDF-` magic bytes;
- at most 5 MiB per file and 10 MiB combined;
- attachment filename is sanitized and never used as an R2 key directly.

Response `200` or `207` for partial failure:

```json
{
  "batch_id": "uuid",
  "sent": 19,
  "failed": 1,
  "results": [
    {
      "candidate_id": "candidate-id",
      "status": "SENT",
      "provider_message_id": "gmail-message-id",
      "error_code": null
    }
  ]
}
```

The server re-loads candidate email/name/role from D1. It never trusts those fields from the browser. A repeated `idempotency_key` returns the stored batch result and sends nothing again.

## 7. Provider Boundary

```js
// functions/lib/mail/provider.js
export function createMailProvider(env) {}

// resolved provider contract
provider.send({
  from: { email, name },
  to: { email, name },
  subject,
  text,
  attachments: [{ filename, contentType, bytes }]
}) // -> Promise<{ messageId: string }>
```

Only `functions/lib/mail/gmail.js` knows Gmail OAuth endpoints and `users.messages.send`. The API orchestration imports `createMailProvider`, never the Gmail adapter directly.

The Gmail adapter:

1. Exchanges the stored refresh token for a short-lived access token.
2. Builds one RFC 5322 MIME message using the existing MIT-licensed [`mimetext`](https://github.com/muratgozel/MIMEText) package.
3. Sends the base64url message to Gmail REST with `fetch`.
4. Returns the Gmail message ID and a normalized error.

This follows the tested Cloudflare Worker pattern in [`mkpoli/gmail-mcp`](https://github.com/mkpoli/gmail-mcp): use Gmail REST via `fetch` rather than the Node-oriented `googleapis` SDK. Do not copy that project wholesale; reuse only the reviewed OAuth refresh, MIME/header validation, and REST request patterns allowed by its MIT license.

Required production secrets/variables:

```text
MAIL_PROVIDER=gmail
MAIL_FROM_EMAIL=recruit@example.com
MAIL_FROM_NAME=株式会社K-ANH人材紹介
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

Secrets are configured in Cloudflare and never stored in Git, D1, browser JavaScript, logs, or API responses. Use the minimal Google scope `https://www.googleapis.com/auth/gmail.send`.

## 8. Persistence and Audit

Add migration `0004_add_email_batches.sql`:

```sql
CREATE TABLE email_batches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  company_name TEXT NOT NULL,
  attachment_names_json TEXT NOT NULL DEFAULT '[]',
  requested_count INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  sent_at TEXT,
  UNIQUE(batch_id, candidate_id)
);
```

Do not store attachment bytes in D1. In v1, attachments remain in request memory only and are not retained after sending. Audit rows store filenames, message content, delivery status, and provider message ID, but never OAuth tokens.

## 9. Error Model

Normalized pre-send errors:

- `EMAIL_MISSING`
- `EMAIL_INVALID`
- `ROLE_MISSING`
- `ROLE_AMBIGUOUS`
- `COMPANY_MISSING`
- `ATTACHMENT_INVALID`
- `BATCH_LIMIT_EXCEEDED`

Normalized delivery errors:

- `PROVIDER_AUTH_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_REJECTED`
- `PROVIDER_UNAVAILABLE`
- `UNKNOWN_SEND_ERROR`

Never log message body, attachment bytes, access token, refresh token, or full provider response. Logging may include `batch_id`, candidate ID, normalized error code, and provider HTTP status.

## 10. Concurrency and Retry Rules

- Send at most three Gmail requests concurrently.
- Retry only `429` and `5xx`, at most twice, honoring `Retry-After` when present.
- Do not retry `4xx` validation/auth errors automatically.
- Successful delivery rows are immutable for the same batch/idempotency key.
- A partial batch returns `207`; the operator may create a new batch containing only failed candidates.

## 11. Testing Strategy

- Unit-test the exact Japanese subject/body, `職` normalization, Unicode names, header-injection rejection, MIME attachment construction, and provider error mapping.
- API-test authorization, server-side reloading of recipients, batch limits, attachment validation, idempotency, partial failure, and audit rows with a fake provider.
- UI-test button visibility, compose validation, blocked rows, preview navigation, confirmation, and partial-result rendering.
- Integration test in dry-run mode first; then send to two internal test mailboxes and verify Japanese text and PDF attachment manually.
- Production verification uses test records only, then deletes those test candidates and their R2 CV files. It must never delete real candidate data.

## 12. Feature Ownership and Merge Order

| Order | Feature branch | Agent ownership | Depends on | Must not edit |
|---|---|---|---|---|
| 1 | `codex/email-role-classification` | Role classification and candidate API contract | none | mail provider/UI |
| 1 | `codex/email-provider-core` | Template, MIME, Gmail adapter, provider interface | none | `index.html`, D1 schema |
| 2 | `codex/email-compose-ui` | Selection-to-compose user interface | published API contracts | provider internals, migrations |
| 2 | `codex/email-batch-api` | Preview/send APIs, audit tables, idempotency | role + provider contracts | `index.html` |
| 3 | `codex/email-integration-release` | Merge validation, docs, dry-run and production checklist | all four features | new product behavior |

Each Agent starts from current `origin/main`, opens a PR, and comments with branch, scope, files changed, tests run, and known limitations. No Agent commits directly to `main`. After a PR is merged, delete its feature branch. Deployment is a separate explicit user request.

## 13. Definition of Done

- A selected batch produces separate personalized messages with correct company and per-candidate role.
- The exact recipient/subject/body is visible before send.
- Only shared job/company PDFs can be attached; CVs are not attached automatically.
- Gmail/Workspace sends through one configured company mailbox.
- Provider-specific code is isolated behind the provider contract.
- Partial failures and retries cannot duplicate successful messages.
- Audit records explain what was sent without exposing secrets or attachment contents.
- All automated tests pass and the two-mailbox integration test is recorded.
- No direct commit to `main`; no automatic production deployment.
