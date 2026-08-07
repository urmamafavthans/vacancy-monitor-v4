# Vacancy Monitor v4

Vacancy-monitor pipeline for a Google Sheets control panel.

## Architecture

`URL_MASTER → GitHub Actions → Crawlee → ENTRY → SOURCE → JOB verification → VACANCY_LOG`

Rejected or ambiguous candidates go to `SCAN_DIAGNOSTICS` and never enter `VACANCY_LOG`.

## Current state

This repository is at **Phase 3–6 preflight**.

- Google Sheets contract is defined.
- Repository authentication preflight is implemented.
- Regression tests protect against the v3.4 navigation false positives.
- Crawling is intentionally disabled until the Phase 7 router is implemented and accepted.

## Required repository secrets

Create these under **Settings → Secrets and variables → Actions**:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — entire JSON key for the dedicated Google service account.
- `SPREADSHEET_ID` — the v4 workbook ID.

Never commit credential JSON files to this repository.

## Run the preflight

Open **Actions → Vacancy Monitor v4 — Preflight → Run workflow**.

Success means:

1. dependencies install;
2. regression tests pass;
3. the service account can open the workbook;
4. `URL_MASTER` matches the v4 schema;
5. the three proof-of-concept institutions exist;
6. `CONFIG → MIGRATION_STATE` becomes `GITHUB_SHEETS_AUTH_OK`.

No website crawling occurs during preflight.
