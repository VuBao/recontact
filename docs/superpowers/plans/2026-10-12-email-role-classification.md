# Email Role Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert each CV's folder/job classification into exactly one queryable role used by email preview and send.

**Architecture:** Keep `jobs` and `job_candidates` as the normalized source of truth. The import API accepts `role_title`, upserts a job, and assigns the new candidate. Candidate listing exposes resolved role state without guessing.

**Tech Stack:** Cloudflare Pages Functions, D1/SQLite, Node test runner, browser `FormData` contract.

**Spec:** `docs/superpowers/specs/2026-10-12-bulk-candidate-email-design.md`

## Global Constraints

- Branch: `codex/email-role-classification`; never commit to `main`.
- Own only classification schema/API behavior. Do not implement email sending or compose UI.
- Preserve existing candidate rows; migration must be additive and rerunnable.
- New tests go in a dedicated test file to minimize merge conflicts.

## Review Focus

- Folder titles are normalized consistently.
- Duplicate jobs/assignments are impossible under concurrent imports.
- Missing and ambiguous role states are explicit.
- No CV contents or PII are logged.

---

### Task 1: Lock the role-resolution contract with failing tests

**Files:**
- Create: `test/role-classification.test.js`
- Modify: none

- [ ] Add fake-D1 tests for one active assignment, no assignment, and multiple active assignments.
- [ ] Assert the candidate response fields: `role_id`, `role_title`, `role_status` (`READY`, `ROLE_MISSING`, `ROLE_AMBIGUOUS`).
- [ ] Add import tests asserting `role_title` is required and normalized before persistence.
- [ ] Run `node --test test/role-classification.test.js` and confirm the tests fail for the expected missing behavior.

### Task 2: Make job titles uniquely addressable

**Files:**
- Create: `migrations/0003_add_role_classification.sql`
- Modify: `schema.sql`

- [ ] Add a normalized `title_key` to `jobs` and a unique index for active role identity.
- [ ] Backfill existing jobs using a deterministic lowercase/trim normalization compatible with SQLite.
- [ ] Document how an existing duplicate title is handled before the unique index is created.
- [ ] Apply to a disposable local D1 database twice and verify both runs are safe.
- [ ] Run `npm run db:local`.

### Task 3: Persist classification during PDF import

**Files:**
- Modify: `functions/api/import.js`
- Modify: `functions/api/jobs.js`
- Modify: `test/role-classification.test.js`

- [ ] Read `role_title` from `FormData`, trim it, cap it at 160 characters, and reject empty/invalid input.
- [ ] Upsert the normalized job and create `job_candidates` in the same logical import transaction after the candidate insert.
- [ ] If assignment persistence fails, remove the uploaded R2 object and candidate row so no half-import remains.
- [ ] Return `role_id` and `role_title` in the import response.
- [ ] Run `node --test test/role-classification.test.js`.

### Task 4: Expose deterministic role state in candidate listing

**Files:**
- Modify: `functions/api/candidates.js`
- Modify: `test/role-classification.test.js`

- [ ] Join active jobs through `job_candidates` without duplicating candidate rows.
- [ ] Return the single role when exactly one exists; otherwise return the explicit missing/ambiguous state.
- [ ] Preserve all existing candidate response fields and ordering.
- [ ] Run `npm test`.

### Task 5: Provide a safe one-time folder backfill for existing CVs

**Files:**
- Create: `tools/backfill_roles_from_folders.py`
- Create: `tools/role-folder-map.example.json`
- Modify: `.gitignore`
- Modify: `test/role-classification.test.js`

- [ ] Add a dry-run fixture with matched, unmatched, duplicate-hash, and unmapped-folder PDFs.
- [ ] Hash PDFs locally and match only against `candidates.file_hash`; never match by display name or filename.
- [ ] Require an explicit folder-to-canonical-role mapping. Do not strip date/suffix text automatically.
- [ ] Default to a non-writing report with counts and proposed assignments; require an explicit `--apply` plus database target to write.
- [ ] Ignore real mapping/report files and local paths; commit only a synthetic example.
- [ ] Test against a disposable local D1 and confirm rerunning creates no duplicate jobs/assignments.

### Task 6: Self-review and handoff

- [ ] Compare every response field and error state against the spec.
- [ ] Review migration compatibility with production D1 and confirm no destructive statement exists.
- [ ] Run `git diff --check && npm test`.
- [ ] Commit only this feature: `git commit -m "feat: normalize candidate role classification"`.
- [ ] Open a PR and comment: branch, scope, exact files, migration/backfill commands, dry-run counts, test output, and remaining unmatched CVs.

