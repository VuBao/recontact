# Recontact MVP

A minimal dashboard that turns PDF CVs into one searchable candidate list.

## Current capabilities

- Upload one or more PDF CVs
- Extract name, age, phone, email, current visa, and Japanese level with the OpenAI Responses API
- Show every candidate in one searchable table
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

For a functional local server (including Pages Functions, D1, and R2), configure `.dev.vars` and use `npm run db:local` followed by `npm run dev`. A static HTTP server cannot process CV uploads.
