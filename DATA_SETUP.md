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

Run `schema.sql` in the D1 console before using the API.

## Pilot data

After the bindings and schema are ready, verify `/api/health`. The `/api/seed` route can insert 10 synthetic pilot candidates only when called with `Authorization: Bearer <ADMIN_TOKEN>`.

Real CVs must be uploaded to R2 later through an authenticated admin-only upload flow; do not commit them to this repository.
