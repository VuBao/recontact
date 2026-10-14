# Application Session Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the dashboard and every API protected when Cloudflare Access cannot establish a session on the Pages hostname.

**Architecture:** Add a small application-owned email OTP flow. Gmail sends a short-lived code; the worker signs a one-year HttpOnly session cookie with an environment secret. Existing Cloudflare Access JWT authorization remains accepted, and all endpoints continue to call the same authorization guard.

**Tech Stack:** Cloudflare Pages Functions, Web Crypto HMAC/SHA-256, existing Gmail provider, browser `dialog` UI, Node test runner.

**Spec:** User-approved fallback to an application session when Access is unavailable.

## Global Constraints

- Never expose a provider refresh token or session signing secret to the browser.
- Keep Cloudflare Access JWT authentication valid.
- Allow only configured staff emails.
- OTP expires after 10 minutes; session expires after 1 year.
- Work only on the feature branch; do not modify `main`.

## Review Focus

- Missing/invalid session cookie must return 401.
- Expired or tampered OTP/session must be rejected.
- Unapproved email must not receive a code.
- Existing Access JWT requests must continue to pass.
- Login UI must recover from an API 401 without exposing protected data.

### Task 1: Signed auth primitives and guard

**Files:**
- Modify: `functions/lib/auth.js`
- Test: `test/auth.test.js`

- [ ] Add HMAC signing, cookie parsing, OTP/session claims, and `authorized(request, env)` support for either Access JWT or a valid app session.
- [ ] Add tests for valid, expired, tampered, and Access-JWT requests.

### Task 2: OTP endpoints

**Files:**
- Create: `functions/api/auth/request.js`
- Create: `functions/api/auth/verify.js`
- Create: `functions/api/auth/logout.js`
- Test: `test/auth-api.test.js`

- [ ] Request endpoint validates configured staff email, sends OTP through Gmail, and sets a signed challenge cookie.
- [ ] Verify endpoint validates the challenge and sets a one-year session cookie.
- [ ] Logout clears the session cookie.
- [ ] Test the endpoint contracts with mocked provider/fetch behavior.

### Task 3: Minimal login dialog

**Files:**
- Modify: `index.html`
- Test: `test/auth-ui.test.js`

- [ ] Add hidden email/code dialog and login controls.
- [ ] On API 401, open the dialog; request and verify code through the new endpoints.
- [ ] Reload protected data after successful verification.
- [ ] Keep the existing protected API and CV flows unchanged.

### Task 4: Verify and deploy

- [ ] Run `npm test`.
- [ ] Configure `APP_AUTH_EMAILS` and `APP_SESSION_SECRET` in production without printing secret values.
- [ ] Deploy the feature branch preview and verify login/API behavior.
- [ ] Commit only feature files; do not merge or deploy production without explicit request.
