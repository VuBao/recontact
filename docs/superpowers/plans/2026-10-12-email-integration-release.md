# Candidate Email Integration Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the four email features, validate them end-to-end without contacting real candidates, document one-time Gmail setup, and prepare—but do not automatically perform—the production deploy.

**Architecture:** This is a release/verification branch only. It resolves merged contract differences, adds configuration documentation and dry-run fixtures, and produces evidence for a human-approved deployment.

**Tech Stack:** Existing project stack, Wrangler local Pages/D1, Gmail test mailbox, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-bulk-candidate-email-design.md`

## Global Constraints

- Branch: `codex/email-integration-release`; never commit to `main`.
- Start only after the four feature PRs are approved/merged in dependency order.
- Do not add new product behavior or broaden the first release.
- Never use real candidate addresses in tests. Deployment requires a separate explicit user request.

## Review Focus

- Cross-feature contracts match exactly.
- Production migration/config steps are reversible and secrets stay out of Git.
- No test can send to a real candidate.
- Evidence covers Japanese text and PDF attachment rendering.

---

### Task 1: Merge-contract audit

**Files:**
- Modify only when a contract mismatch is proven
- Create: `docs/email-provider-setup.md`

- [ ] Compare UI request/response shapes against both API handlers.
- [ ] Compare API provider calls against the provider interface.
- [ ] Compare role states against candidate listing and preview resolver.
- [ ] Document Google Cloud OAuth client creation, `gmail.send` consent, refresh-token acquisition, Cloudflare variables/secrets, rotation, and revocation.
- [ ] Run `npm test`.

### Task 2: Local dry-run end-to-end validation

**Files:**
- Create: `test/email-e2e.test.js`
- Modify: configuration/docs only if required

- [ ] Seed only synthetic candidates with one role each and internal `example.test` addresses.
- [ ] Replace the real provider with a fake capture provider.
- [ ] Verify selection → preview → multipart send → audit → UI summary.
- [ ] Verify no candidate CV bytes appear in the outbound attachment collection.
- [ ] Delete all synthetic D1/R2 test data and confirm clean state.
- [ ] Run `npm test` and record output in the PR.

### Task 3: Controlled Gmail integration test

**Files:**
- No source changes expected

- [ ] Configure secrets outside Git in a non-production/preview environment.
- [ ] Use exactly two company-owned test recipients and one small synthetic PDF.
- [ ] Verify separate To headers, Japanese subject/body, reply behavior, filename, and byte-identical attachment.
- [ ] Retry the same idempotency key and verify no duplicate delivery.
- [ ] Remove test rows and any test R2 objects; preserve only non-sensitive batch IDs/test results.

### Task 4: Release gate and handoff

- [ ] Run `git diff --check && npm test`.
- [ ] Confirm migrations are additive and production secrets are present by name only.
- [ ] Confirm production candidate count is unchanged before/after validation.
- [ ] Commit release-only changes: `git commit -m "docs: prepare candidate email release"`.
- [ ] Open a PR and comment: branch, merged feature SHAs, tests, manual Gmail evidence, cleanup proof, migration order, rollback, and known limits.
- [ ] Stop. Do not merge or deploy until the user explicitly requests it.

