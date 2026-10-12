# Recontact MVP

A lightweight dashboard for managing a reusable CV talent pool.

## Current capabilities

- Filter candidates by labels and search text
- Track the flow: Talent pool → selected → email sent → interested → interview booked
- Import a folder of PDF, DOC, or DOCX CVs through the dashboard
- Store CV files privately in Cloudflare R2 and candidate metadata in Cloudflare D1
- Load the dashboard talent pool from D1 instead of hard-coded browser data
- Create jobs and persist each candidate's progress per job
- Keep all data APIs protected by the Cloudflare `ADMIN_TOKEN` secret

## Source of truth

This repository is the source deployed by Cloudflare Pages:

- `index.html`: dashboard UI
- `functions/api/`: protected backend endpoints
- `schema.sql`: D1 schema
- `DATA_SETUP.md`: Cloudflare binding setup

No real CVs, API keys, or secrets belong in this repository.
