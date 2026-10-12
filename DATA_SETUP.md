# Recontact data setup

The dashboard source contains no real CV data.

## Cloudflare bindings

Create these resources in the same Cloudflare account as the Pages project:

- D1 database: `recontact-db`
- R2 bucket: `recontact-cv-private`

In **Workers & Pages → recontact-7e8 → Settings → Bindings**, add:

| Variable | Resource |
| --- | --- |
| `DB` | D1 database `recontact-db` |
| `CV_BUCKET` | R2 bucket `recontact-cv-private` |

Then add a secret in **Settings → Variables and Secrets**:

- `ADMIN_TOKEN`: a long random value. Never put this value in GitHub or the frontend.
- `OPENAI_API_KEY`: an OpenAI API key used server-side to read PDF CVs.

Optional environment variable:

- `OPENAI_MODEL`: defaults to `gpt-6-astra`.

For a new database, run `schema.sql` in the D1 console. For an existing Recontact database, run `migrations/0002_add_cv_profile_fields.sql` once.

## Dashboard session

After the bindings, schema, and secrets are ready, verify `/api/health`.

The dashboard uses the admin token once to create a signed, HTTP-only one-year session cookie. It then calls:

- `/api/import` to send a PDF to OpenAI for structured extraction, save the PDF in R2, and save the fields in D1
- `/api/candidates` to load the candidate list
- `/api/cv` to open the authenticated private PDF

The token is never written to local storage or committed to this repository. The cookie contains only an expiry time and an HMAC signature derived from the secret, not the secret itself.

Real CVs must only be uploaded through the authenticated dashboard; do not commit them to this repository.
