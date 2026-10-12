# Recontact MVP

A minimal dashboard that turns PDF CVs into one searchable candidate list.

## Current capabilities

- Upload one or more PDF CVs
- Extract name, age, phone, email, current visa, and Japanese level with the OpenAI Responses API
- Show every candidate in one searchable table
- Open the original private PDF from the candidate row
- Store CV files privately in Cloudflare R2 and extracted fields in Cloudflare D1
- Sign in once and keep the dashboard session in a secure, HTTP-only one-year cookie
- Keep all data APIs protected by the Cloudflare `ADMIN_TOKEN` secret

## Source of truth

This repository is the source deployed by Cloudflare Pages:

- `index.html`: dashboard UI
- `functions/api/`: protected backend endpoints
- `schema.sql`: D1 schema
- `DATA_SETUP.md`: Cloudflare binding setup

No real CVs, API keys, or secrets belong in this repository.
