# Candidate Response Sidebar Manual Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing candidate response sidebar with a true desktop-left layout, manual confirmed entries, and 100-character staff notes.

**Architecture:** Retain the existing D1 `candidates` response columns and Gmail-sync endpoint. Add one nullable note column and a dedicated authenticated manual-create endpoint, then extend the existing plain HTML/CSS/JS response sidebar with a modal that chooses an already-loaded candidate.

**Tech Stack:** Cloudflare Pages Functions, D1/SQLite migrations, vanilla HTML/CSS/JavaScript, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-14-candidate-response-sidebar-manual-design.md`

## Global Constraints

- Work only on the existing feature branch; do not modify `main`.
- Do not add dependencies or an LLM-based email classifier.
- Automatic replies remain `PENDING`; manual records start `CONFIRMED`.
- Notes are trimmed and limited to 100 characters on client and server.
- Manual creation only links an existing candidate; it never creates a CV/candidate.

## Review Focus

- A manual request for a nonexistent candidate must return 404 without creating a response record (Task 2).
- A 101-character note must fail server-side even if a modified browser bypasses the UI limit (Task 2).
- A Gmail sync must retain red `PENDING` behaviour and must not accidentally make the record green (Task 2).
- Small viewports must put dashboard content before the sidebar instead of overflowing horizontally (Task 1).
- A failed modal save must retain staff-entered fields so they can correct and retry (Task 3).

---

### Task 1: Wire the existing sidebar layout

**Files:**
- Modify: `index.html`
- Test: `test/response-sidebar-ui.test.js`

**Interfaces:**
- Consumes: existing `#response-sidebar`, `.dashboard-layout`, and `.dashboard-content` markup.
- Produces: desktop two-column layout and responsive mobile ordering.

- [ ] Add a failing UI assertion that the dashboard root includes `dashboard-layout` and a sidebar header action.
- [ ] Run `node --test test/response-sidebar-ui.test.js`; expect failure.
- [ ] Apply the grid class to the dashboard root and add `＋ Thêm mới` to the sidebar header without changing the existing response list.
- [ ] Run `node --test test/response-sidebar-ui.test.js`; expect pass.
- [ ] Commit the focused layout change.

### Task 2: Persist notes and create manual confirmed responses

**Files:**
- Create: `migrations/0006_add_candidate_response_note.sql`
- Modify: `functions/api/mail/responses.js`
- Create: `functions/api/mail/responses/manual.js`
- Test: `test/candidate-responses-api.test.js`

**Interfaces:**
- Consumes: `candidate_id`, four response values, and optional `note` from the modal.
- Produces: `POST /api/mail/responses/manual` returning `{ created, candidate_id, status: 'CONFIRMED' }`.

- [ ] Add failing tests for manual success, unknown candidate (404), note length >100 (400), note exposure in GET/PATCH, and automatic sync `PENDING` behaviour.
- [ ] Run `node --test test/candidate-responses-api.test.js`; expect failure.
- [ ] Add `response_note` migration and update GET/PATCH response data and validation.
- [ ] Implement the manual endpoint using an existence query followed by a single update; set `CONFIRMED`, timestamps, and clear message ID.
- [ ] Run `node --test test/candidate-responses-api.test.js`; expect pass.
- [ ] Commit the data/API change.

### Task 3: Add the manual-response modal and block note editor

**Files:**
- Modify: `index.html`
- Test: `test/response-sidebar-ui.test.js`

**Interfaces:**
- Consumes: loaded `candidates` list and `POST /api/mail/responses/manual`.
- Produces: manual form lifecycle, manual `CONFIRMED` block, and editable note on each block.

- [ ] Add failing UI assertions for modal, candidate search/select controls, `maxlength="100"`, and manual endpoint usage.
- [ ] Run `node --test test/response-sidebar-ui.test.js`; expect failure.
- [ ] Add modal markup/styles and JS: search existing loaded candidates, select exactly one, submit manually, preserve form values on failure, reload blocks on success.
- [ ] Extend block render/save payload to display and save `response_note`.
- [ ] Run `node --test test/response-sidebar-ui.test.js`; expect pass.
- [ ] Commit the UI change.

### Task 4: Full verification

**Files:**
- Modify only if verification exposes a scoped defect.

- [ ] Run `npm test`; expect all tests pass.
- [ ] Run a local Pages smoke test for the modal and response endpoint with authenticated test credentials.
- [ ] Review `git diff` to ensure no unrelated user files are included.
- [ ] Commit any scoped repair separately.
