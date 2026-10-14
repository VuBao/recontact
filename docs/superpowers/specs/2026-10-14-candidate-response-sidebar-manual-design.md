# Candidate Response Sidebar — Manual Registration Design

## Intent

Staff need one compact workflow for candidate replies: Gmail replies are collected automatically when they can be matched safely, while unmatched replies can be recorded against an existing CV manually. The response workflow must be visible beside the dashboard list rather than above it.

## Goals

- Render the `Phản hồi ứng viên` sidebar on the left of the CV dashboard on desktop.
- Keep the CV dashboard as the main content area on the right.
- Display only candidates with a response record in the sidebar.
- Preserve automatic Gmail response sync: a reply matched by sender email and the four fixed Japanese labels creates or refreshes a `PENDING` response.
- Add a `Thêm mới` action that lets staff register a response manually against an existing candidate.
- Give manually registered responses the `CONFIRMED` status immediately.
- Store an editable note of at most 100 characters for every response block.
- Preserve the existing expandable block UI, fixed Japanese fields, CV-open action, confirmation action, and completion action.

## Non-goals

- Do not create candidates or upload CVs from the response modal.
- Do not use an LLM or token-consuming service to classify reply email.
- Do not infer a candidate when the sender email does not exactly match a candidate email.
- Do not change Gmail OAuth scopes beyond the existing `gmail.readonly` and `gmail.send` permissions.
- Do not alter the candidate list table, CV storage, or bulk-mail workflow.

## Existing Behaviour to Preserve

- The parser reads only these labels from an email body:
  - `氏名：`
  - `電話番号：`
  - `電話に出られる曜日・時間：`
  - `勤務開始可能日：`
- Automatic sync selects the latest matching reply per candidate and marks it `PENDING`.
- `PENDING` is light red, `CONFIRMED` light green, and `COMPLETED` light yellow.
- Staff can edit the four response fields after opening a block.
- The existing `Mở CV` action continues to use the candidate's stored CV.

## Feature 1 — Sidebar Layout

### Outcome

The response area is a true left sidebar on desktop, aligned with the dashboard's top edge; it no longer appears above the dashboard.

### Behaviour

- Apply the existing two-column `dashboard-layout` grid to the dashboard container.
- Left column is `250px`; the CV dashboard uses the remaining width.
- The sidebar remains sticky while desktop users scroll the candidate list.
- At viewport widths of `900px` or less, show the dashboard first and response blocks below it in a responsive grid; at `720px` or less, use one block per row.
- The sidebar heading, short explanatory text, and `Thêm mới` action form its header. When there are no records, retain the small `Chưa có phản hồi.` empty state.

## Feature 2 — Response Record Extension and Manual API

### Data model

Add `response_note TEXT` to `candidates`. It is nullable for existing rows and constrained by API validation to 100 characters after trimming.

### API additions

`POST /api/mail/responses` currently synchronizes Gmail replies. It remains a sync-only endpoint.

Add `POST /api/mail/responses/manual`:

```json
{
  "candidate_id": "existing-candidate-id",
  "name": "candidate response name",
  "phone": "phone response",
  "availability": "available days and times",
  "start_date": "available work start date",
  "note": "optional note, max 100 characters"
}
```

Rules:

- Require authenticated staff and the D1 binding, consistent with the existing response endpoints.
- `candidate_id` must reference an existing candidate.
- Create/update only that candidate's response fields.
- Set `response_status = 'CONFIRMED'`.
- Set `response_confirmed_at` to the server timestamp.
- Clear `response_message_id`, because the source is manual rather than a Gmail message.
- Set `response_received_at` to the server timestamp for ordering.
- Return `{ "created": true, "candidate_id": "…", "status": "CONFIRMED" }`.

### Existing API changes

- `GET /api/mail/responses` returns `response_note`.
- `PATCH /api/mail/responses` accepts and saves `note` with the same 100-character limit.
- Gmail sync sets `response_note = NULL` only when it receives a newer Gmail reply that replaces the source record; it preserves the current field otherwise.
- Automatic sync must keep its `PENDING` status behaviour, even if a manual confirmed record previously existed and a newer matched reply is found.

## Feature 3 — Manual Registration Modal

### Entry point

Place a `＋ Thêm mới` button in the sidebar header.

### Modal contents

- Candidate search input with the existing dashboard matching terms: name, phone, or email.
- Search results from the already loaded candidate list; staff selects exactly one existing candidate.
- Four editable fields labelled exactly as the response block:
  - `氏名：`
  - `電話番号：`
  - `電話に出られる曜日・時間：`
  - `勤務開始可能日：`
- `Ghi chú` field with a visible 100-character maximum.
- `Hủy` and `Lưu phản hồi` actions.

### Behaviour

- Disable saving until a candidate is selected.
- Show the selected candidate's name and email to avoid attaching data to the wrong CV.
- On save, call `POST /api/mail/responses/manual`, close the modal, reload the sidebar, and show a success message.
- A saved manual response appears immediately as a green `Đã xác nhận` block.
- Any API validation or network error remains in the modal and does not discard typed fields.

## Feature 4 — Block Note and Workflow UX

### Block summary

- Keep the compact collapsed shape: candidate name, status dot, and `＋` expand affordance.
- Use the candidate's dashboard name as the block title; do not use untrusted parsed email content as a replacement title.

### Expanded detail

- Show the four response fields and the editable `Ghi chú` field.
- Limit the note input to 100 characters client-side and enforce the same server-side limit.
- Keep `Mở CV`, save/confirm, and `Đánh dấu hoàn thành` actions.
- Saving a block retains its current status; manual records remain `CONFIRMED` unless staff selects completion.
- Completion changes the block to `COMPLETED`/light yellow and retains all fields and note.

## Feature 5 — Verification

- Migration test: `response_note` exists and old candidate rows remain usable.
- API tests: manual creation requires an existing candidate, is `CONFIRMED`, saves all four fields and note, rejects a note longer than 100 characters, and keeps Gmail sync records `PENDING`.
- UI tests: dashboard container uses the two-column layout, sidebar has `Thêm mới`, the modal filters/selects candidates, and block note input is present and limited.
- Regression tests: current Gmail parser, automatic sync, response confirmation, completion, and CV-open interactions continue to work.
- Manual browser smoke check: desktop sidebar sits left of the dashboard; a manual entry creates a green block; a matching Gmail reply creates a red block.

## Builder Decisions

- Reuse the current plain HTML/CSS/JavaScript pattern and existing `/api/mail/responses` module; do not add a UI framework or dependency.
- Keep manual creation in a separate endpoint to avoid mixing a state-changing manual operation with Gmail sync.
- Use a database migration rather than encoding notes into an existing JSON field, so notes are queryable and survive all normal response updates.
