# Candidate Response Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show only candidates with parsed Gmail replies in a compact expandable sidebar, with staff confirmation, editing, completion status, and a link to the existing CV.

**Architecture:** Store the four parsed response fields and workflow status on each candidate so the existing candidate/CV relationship remains the source of truth. A small Gmail response parser accepts only the four fixed Japanese labels; a sync endpoint applies the newest unconfirmed reply, while a response API saves staff edits and confirmation. The dashboard loads the response list and renders lightweight expandable blocks without changing the existing CV storage flow.

**Tech Stack:** Cloudflare Pages Functions, D1/SQLite, Gmail REST API via `fetch`, vanilla HTML/CSS/JavaScript, Node test runner.

**Spec:** User-confirmed chat specification in the 2026-10-14 task conversation.

## Global Constraints

- Work only on a feature branch; never commit directly to `main`.
- Parse only the exact labels `氏名：`, `電話番号：`, `電話に出られる曜日・時間：`, and `勤務開始可能日：`.
- Do not use AI/LLM/token-based extraction for replies.
- Show only candidates with a response; do not render candidates without a response.
- Reuse the existing `/api/cv?id=...` link for the “Mở CV” action.
- Do not deploy automatically.

## Review Focus

- A malformed or incomplete reply must not be treated as confirmed; parser tests cover missing labels.
- Multiple replies for one candidate must keep the newest reply pending confirmation; API tests cover replacement behavior.
- Staff edits must persist all four fields and status transitions; API tests cover confirmation and completion.
- Gmail/provider configuration must fail safely without exposing tokens or raw provider bodies; sync tests cover missing configuration.
- Sidebar must remain usable on mobile and not affect the existing candidate table; UI tests cover collapsed/expanded blocks and CV links.

### Task 1: Response schema and parser

**Files:**
- Create: `migrations/0005_add_candidate_responses.sql`
- Create: `functions/lib/mail/response-parser.js`
- Test: `test/candidate-response-parser.test.js`

- [ ] Add response fields and indexes with defaults that preserve existing candidates.
- [ ] Implement exact-label parsing with normalized line endings and empty-field handling.
- [ ] Test complete, partial, duplicate-label, and malformed input cases.

### Task 2: Response sync and staff API

**Files:**
- Create: `functions/api/mail/responses.js`
- Modify: `functions/lib/mail/gmail.js`
- Modify: `functions/api/candidates.js`
- Test: `test/candidate-responses-api.test.js`

- [ ] Add a Gmail inbox reader using the existing token refresh path and safe Gmail REST calls.
- [ ] Sync newest matching reply by sender email, storing it as `PENDING`/“Chưa xác nhận”.
- [ ] Return only candidates with response records, including status and existing CV id.
- [ ] Add staff update endpoint for edits, confirmation, and `COMPLETED` status.
- [ ] Test newest-message selection, candidate matching, safe missing configuration, and status transitions.

### Task 3: Sidebar UI

**Files:**
- Modify: `index.html`
- Test: `test/response-sidebar-ui.test.js`

- [ ] Add a sidebar region with one collapsed hex-style block per response candidate.
- [ ] Render name, status color, `+` expansion, four editable fields, save/confirm controls, completion control, and “Mở CV”.
- [ ] Load/sync response data without blocking the existing dashboard when Gmail sync is unavailable.
- [ ] Add responsive CSS and accessible buttons/labels.
- [ ] Test the static UI contract and ensure the existing table/CV link remains unchanged.

### Task 4: Verification

- [ ] Run `npm test`.
- [ ] Run a local Pages smoke check for `/`, `/api/candidates`, and the response endpoint.
- [ ] Review the diff for unrelated files and confirm untracked user files remain untouched.
- [ ] Commit the feature branch only after all checks pass.

