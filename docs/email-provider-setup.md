# Gmail OAuth Setup & Integration Guide

This guide documents the one-time configuration for connecting Recontact's candidate email integration to Google Cloud Gmail API securely, without storing long-lived passwords in source code. The response-sync feature requires both sending and read access.

---

## 1. Google Cloud Console Setup

1. **Create or Select Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project, for example `recontact-production` or `recontact-preview`.

2. **Enable the Gmail API**:
   - Navigate to **APIs & Services → Library**.
   - Search for **Gmail API** and click **Enable**.

3. **Configure OAuth Consent Screen**:
   - Navigate to **APIs & Services → OAuth consent screen**.
   - Select User Type:
     - **Internal**: If using Google Workspace for your organization (recommended).
     - **External**: If using a standard `@gmail.com` account (keep in Testing mode and add authorized test emails).
   - Add App name (e.g., `Recontact Candidate Mailer`) and developer contact email.
   - Under **Scopes**, add:
     - `https://www.googleapis.com/auth/gmail.send` (Send messages on your behalf).
     - `https://www.googleapis.com/auth/gmail.readonly` (Read candidate replies for response extraction).

4. **Create OAuth 2.0 Credentials**:
   - Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application** (or **Desktop app** for quick offline token acquisition).
   - If Web application, set Authorized redirect URIs:
     - `https://developers.google.com/oauthplayground` (for initial token generation) or your internal callback URL.
   - Note the generated:
     - `Client ID`
     - `Client Secret`

---

## 2. Refresh Token Acquisition (One-Time)

Using Google OAuth 2.0 Playground:

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the settings gear icon (top right):
   - Check **Use your own OAuth credentials**.
   - Enter your `OAuth Client ID` and `OAuth Client Secret`.
3. In Step 1 (Select & authorize APIs):
   - Scroll to **Gmail API v1**.
   - Select both scopes:
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.readonly`
   - Click **Authorize APIs** and sign in with the sending mailbox.
4. In Step 2 (Exchange authorization code for tokens):
   - Click **Exchange authorization code for tokens**.
   - Copy the generated `Refresh token`.

---

## 3. Cloudflare Pages Configuration

Set the credentials securely in Cloudflare Pages. Never commit secret values to Git!

### Production Environment
In Cloudflare Dashboard:
**Workers & Pages → [your-project] → Settings → Variables and Secrets**

Add the following as **Encrypted Secrets**:

| Secret Name | Description | Example / Note |
|---|---|---|
| `GMAIL_CLIENT_ID` | OAuth Client ID from Google Cloud | `xxxx.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | OAuth Client Secret | `GOCSPX-xxxx` |
| `GMAIL_REFRESH_TOKEN` | Refresh token generated in step 2 | `1//04xxxx` |

Also add these non-secret production variables:

| Variable | Value |
|---|---|
| `MAIL_PROVIDER` | `gmail` |
| `MAIL_FROM_EMAIL` | The shared company mailbox used to authorize Gmail |
| `MAIL_FROM_NAME` | `株式会社K-ANH人材紹介` (or the approved sender name) |

### Local Development / Preview
In `.dev.vars` (which is excluded by `.gitignore`):

```dotenv
GMAIL_CLIENT_ID=your_local_client_id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your_local_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token
MAIL_PROVIDER=gmail
MAIL_FROM_EMAIL=recruit@example.com
MAIL_FROM_NAME=株式会社K-ANH人材紹介
```

---

## 4. Credential Rotation & Revocation

### Rotating Tokens
1. Generate a new refresh token using OAuth Playground or OAuth flow with the client credentials and both scopes above. The existing send-only refresh token cannot be expanded in place.
2. In Cloudflare Pages Settings → Variables and Secrets, update `GMAIL_REFRESH_TOKEN` with the new value.
3. Trigger a redeployment or verify on the next request.

### Revoking Access
- To immediately invalidate credentials:
  - Visit [Google Account Permissions](https://myaccount.google.com/permissions) and revoke access for the app.
  - Or execute a revocation POST:
    ```bash
    curl -X POST "https://oauth2.googleapis.com/revoke?token=<REFRESH_TOKEN>" \
      -H "Content-Type: application/x-www-form-urlencoded"
    ```

---

## 5. Security & Safety Checklist

- [x] **No candidate CVs attached**: Outbound attachments are strictly limited to user-uploaded job descriptions/brochures validated by magic bytes.
- [x] **Safe error reporting**: All delivery errors strip authorization headers, OAuth bearer tokens, and internal stack traces.
- [x] **Separate To headers**: Each email is sent individually per candidate to prevent cross-candidate PII leakage.
- [x] **Idempotency enforcement**: Repeated calls with the same `idempotency_key` return stored audit results and do not re-contact candidates.
- [x] **Zero real candidate emails in testing**: All automated and dry-run tests use `@example.test` or dedicated test company inboxes.
- [ ] **Controlled live test**: Before production use, send only to two approved internal mailboxes and manually verify the Japanese body and selected PDF attachment.
