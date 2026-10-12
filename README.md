# Recontact MVP

A minimal dashboard that turns PDF CVs into one searchable candidate list.

## Current capabilities

- Upload one or more PDF CVs
- Extract name, age, phone, email, current visa, and Japanese level with the OpenAI Responses API
- Extract selectable text locally with `pdfminer.six` during local development (no AI call)
- Show every candidate in one searchable table, 10 records per page, with a running number (STT) that continues across pages
- List candidates with the highest Japanese level first (N1 → N5, no level last) unless a column sort is chosen
- Open the original private PDF from the candidate row
- Store CV files privately in Cloudflare R2 and extracted fields in Cloudflare D1
- Sign in by email through Cloudflare Access
- Keep the dashboard, APIs, and private PDFs behind the same Access policy

## Source of truth

This repository is the source deployed by Cloudflare Pages:

- `index.html`: dashboard UI
- `functions/api/`: protected backend endpoints
- `schema.sql`: D1 schema
- `DATA_SETUP.md`: Cloudflare binding setup

No real CVs, API keys, or secrets belong in this repository.

For local, no-token PDF extraction:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-local.txt
npm run extractor
```

In a second terminal, use `npm run db:local` followed by `npm run dev`. Image-only scanned PDFs require OCR and are rejected instead of creating incorrect data.
