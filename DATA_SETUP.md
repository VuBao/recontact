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

Then add this secret in **Settings → Variables and Secrets**:

- `OPENAI_API_KEY`: an OpenAI API key used server-side to read PDF CVs.

Optional environment variable:

- `OPENAI_MODEL`: defaults to `gpt-6-astra`.

For a new database, run `schema.sql` in the D1 console. For an existing Recontact database, run the unapplied migration files once, in numeric order.

Before `migrations/0003_add_role_classification.sql`, run its duplicate-title preflight query. Resolve every duplicate open role deliberately; the migration intentionally fails at the unique index rather than choosing a canonical role automatically.

## Existing CV role backfill

Role backfill is SHA-256 based and defaults to dry-run. It never matches a candidate by name or filename.

1. Copy `tools/role-folder-map.example.json` to the ignored `tools/role-folder-map.json` and map every exact first-level folder name to its canonical role.
2. Export only `id` and `file_hash` from `candidates` to a local ignored JSON file, or point the tool at a disposable local D1/SQLite database.
3. Review a dry-run report:

```sh
python3 tools/backfill_roles_from_folders.py \
  --root /absolute/path/to/cv-folders \
  --mapping tools/role-folder-map.json \
  --candidate-hashes /absolute/path/to/candidate-hashes.json \
  --report tools/role-backfill-report.json
```

4. Apply only after unmatched, ambiguous, and unmapped rows have been reviewed. `--apply` requires an explicit local database target:

```sh
python3 tools/backfill_roles_from_folders.py \
  --root /absolute/path/to/cv-folders \
  --mapping tools/role-folder-map.json \
  --database /absolute/path/to/disposable-d1.sqlite \
  --apply \
  --report tools/role-backfill-report-applied.json
```

The tool does not write directly to production D1. Review its local result before using normal Cloudflare migration/deployment controls; real mappings, reports, and local paths must not be committed.

## Email access

After the bindings, schema, and secrets are ready, verify `/api/health`.

Protect the production `*.pages.dev` hostname and preview deployments with Cloudflare Access. Create an Allow policy restricted to the exact email addresses that may use the dashboard, and enable One-time PIN as the login method. Do not create a policy that allows every OTP user.

Cloudflare Access authenticates the user before the request reaches Pages. The dashboard then calls:

- `/api/import` to send a PDF to OpenAI for structured extraction, save the PDF in R2, and save the fields in D1
- `/api/candidates` to load the candidate list
- `/api/cv` to open the authenticated private PDF

Pages Functions require the `Cf-Access-Jwt-Assertion` header added by Cloudflare Access. The old `ADMIN_TOKEN` secret can be deleted after the Access policy and new deployment are verified.

Real CVs must only be uploaded through the authenticated dashboard; do not commit them to this repository.

## Local development

Local development uses Cloudflare Pages Functions with local D1 and R2 emulators instead of a static file server:

1. Copy `.dev.vars.example` to `.dev.vars` and replace the placeholder with a local OpenAI API key.
2. Run `npm run db:local` once to create the local tables.
3. Run `npm run dev` and open `http://127.0.0.1:8080`.

`.dev.vars`, local D1 data, and local R2 files are ignored by Git. Requests from localhost bypass the Access assertion because they never pass through Cloudflare; production still requires Cloudflare Access.
