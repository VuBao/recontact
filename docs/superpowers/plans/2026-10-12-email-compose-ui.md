# Candidate Email Compose UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing row selection into a clear, responsive compose-and-review workflow without enlarging the dashboard unnecessarily.

**Architecture:** Keep the existing single-page `index.html`. Add one accessible compose dialog that consumes the documented preview/send APIs. It does not construct authoritative recipient data; the server does.

**Tech Stack:** Existing HTML/CSS/vanilla JavaScript, native `<dialog>`, Node test runner with extracted pure view helpers.

**Spec:** `docs/superpowers/specs/2026-10-12-bulk-candidate-email-design.md`

## Global Constraints

- Branch: `codex/email-compose-ui`; never commit to `main`.
- Own `index.html` and UI-specific tests only.
- Preserve delete selection, filters, pagination, mobile cards, and no-horizontal-scroll behavior.
- Do not embed provider credentials or implement Gmail calls in the browser.

## Review Focus

- Send button appears only after selection and cannot be confused with delete.
- Every recipient/role/error is reviewable before confirmation.
- Mobile layout works at 360 px without horizontal scrolling.
- Failed/sent results are understandable and do not silently retry.

---

### Task 1: Add failing UI contract tests

**Files:**
- Create: `test/mail-ui.test.js`
- Modify: none

- [ ] Assert IDs/labels for `send-selected`, compose dialog, company input, attachment input, recipient review, preview body, confirm dialog, and result summary.
- [ ] Extract/test pure helpers for selected eligible count and send-result summary.
- [ ] Run `node --test test/mail-ui.test.js` and confirm expected failures.

### Task 2: Add selection action and compose dialog shell

**Files:**
- Modify: `index.html`
- Modify: `test/mail-ui.test.js`

- [ ] Show **Gửi mail (N)** only when at least one row is selected; keep delete as a distinct red action.
- [ ] Add required company name, shared paragraph, PDF picker, recipient table, per-recipient preview, close/cancel/send controls.
- [ ] Make the dialog keyboard accessible and return focus to the trigger on close.
- [ ] Add mobile styles at existing breakpoints with no horizontal scrollbar.
- [ ] Run `node --test test/mail-ui.test.js test/list-view.test.js`.

### Task 3: Integrate preview API and blocked-candidate states

**Files:**
- Modify: `index.html`
- Modify: `test/mail-ui.test.js`

- [ ] Call `/api/mail/preview` using selected IDs and company/paragraph values after debounce or explicit preview action.
- [ ] Render email, role, subject, `READY` or localized blocking reason for every selected row.
- [ ] Disable final send if preview is stale, any row is blocked, company is empty, or attachments violate client-side limits.
- [ ] Provide previous/next preview without hiding the full recipient list.
- [ ] Run the targeted tests.

### Task 4: Integrate multipart send and results

**Files:**
- Modify: `index.html`
- Modify: `test/mail-ui.test.js`

- [ ] Generate one `crypto.randomUUID()` idempotency key per opened compose session.
- [ ] Post `payload` plus shared PDFs to `/api/mail/send` only after the confirmation dialog.
- [ ] Disable buttons while sending and prevent double submission.
- [ ] Render sent/failed totals and row-level failure reasons from `200`/`207` responses.
- [ ] Keep failed candidate rows selected; clear successful rows only.
- [ ] Run `npm test`.

### Task 5: Browser QA, self-review, and handoff

- [ ] Test at 360, 768, and 1280 px with 0, 1, and 20 recipients.
- [ ] Test keyboard-only flow and visible focus.
- [ ] Verify existing upload, filter, pagination, PDF open, and permanent delete flows.
- [ ] Run `git diff --check && npm test`.
- [ ] Commit only this feature: `git commit -m "feat: add bulk email compose workflow"`.
- [ ] Open a PR and comment: branch, UI states, screenshots, files, tests, API assumptions, and accessibility/mobile notes.

