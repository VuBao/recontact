# Email Batch API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement authenticated preview and idempotent batch send APIs with PDF validation, bounded concurrency, partial-result reporting, and D1 audit records.

**Architecture:** APIs reload authoritative candidate/role data from D1, call the provider-neutral mail core, and persist one batch plus one delivery row per candidate. Attachments live only for the request duration.

**Tech Stack:** Cloudflare Pages Functions, D1, Web `File`/`FormData`, provider core, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-bulk-candidate-email-design.md`

## Global Constraints

- Branch: `codex/email-batch-api`; never commit to `main`.
- Start after the role and provider contracts are available; merge/rebase those branches first.
- Do not modify `index.html`.
- Never accept recipient email/name/role from the browser as authoritative.

## Review Focus

- Idempotency prevents duplicate mail after timeout/retry.
- Authorization and server-side recipient resolution are mandatory.
- Attachment validation checks bytes, not only filename/MIME declaration.
- Partial failures persist accurately and expose only safe error text.

---

### Task 1: Add audit migration and repository helpers

**Files:**
- Create: `migrations/0004_add_email_batches.sql`
- Modify: `schema.sql`
- Create: `functions/lib/mail/batches.js`
- Create: `test/mail-batch-api.test.js`

- [ ] Add failing fake-D1 tests for new batch, existing idempotency key, delivery status updates, and final batch counts.
- [ ] Add the exact tables/indexes from the spec using additive SQL.
- [ ] Implement repository helpers that use bound parameters only.
- [ ] Apply the schema twice against disposable local D1.
- [ ] Run `node --test test/mail-batch-api.test.js`.

### Task 2: Implement authoritative recipient resolution and preview

**Files:**
- Create: `functions/lib/mail/recipients.js`
- Create: `functions/api/mail-preview.js`
- Modify: `test/mail-batch-api.test.js`

- [ ] Test Access rejection, empty/over-limit IDs, missing company, missing/invalid email, missing/ambiguous role, and a valid mixed Unicode recipient.
- [ ] Query selected candidates and active job assignments from D1; preserve request order and reject unknown IDs.
- [ ] Call `renderCandidateEmail` for ready rows and return the spec response.
- [ ] Never read `email`, name, or role from request JSON.
- [ ] Run the targeted tests.

### Task 3: Validate multipart attachments

**Files:**
- Create: `functions/lib/mail/attachments.js`
- Modify: `test/mail-batch-api.test.js`

- [ ] Test count, per-file/combined size, extension, MIME declaration, magic bytes, duplicate names, and sanitized filenames.
- [ ] Return `{ filename, contentType: "application/pdf", bytes }` only after every file passes.
- [ ] Ensure no candidate CV is loaded or auto-attached.
- [ ] Run the targeted tests.

### Task 4: Implement idempotent send orchestration

**Files:**
- Create: `functions/api/mail-send.js`
- Modify: `functions/lib/mail/batches.js`
- Modify: `test/mail-batch-api.test.js`

- [ ] Add failing tests for successful batch, mixed provider failure, repeated key, concurrent cap, retryable/non-retryable errors, and safe response fields.
- [ ] Parse/validate multipart request, re-resolve all recipients, create audit rows, then send with concurrency three.
- [ ] Retry only `429`/`5xx` twice; record `SENT` or `FAILED` per delivery.
- [ ] Return stored results immediately for a completed duplicate key and reject a conflicting payload using the same key.
- [ ] Return `200` when all sent and `207` on partial failure.
- [ ] Run `npm test`.

### Task 5: Self-review and handoff

- [ ] Simulate a client timeout followed by the same idempotency key and prove provider `send` is not called twice.
- [ ] Inspect logs/errors for PII, tokens, bodies, and bytes.
- [ ] Run `git diff --check && npm test`.
- [ ] Commit only this feature: `git commit -m "feat: add idempotent candidate email batches"`.
- [ ] Open a PR and comment: branch, migration, endpoints, limits, test output, partial-failure semantics, and rollback instructions.

