# Vacancy Monitor v4

Vacancy-monitor pipeline for a Google Sheets control panel.

## Architecture

`URL_MASTER → GitHub Actions → Crawlee → ENTRY → SOURCE → JOB verification → VACANCY_LOG`

Rejected or ambiguous candidates go to `SCAN_DIAGNOSTICS` and never enter `VACANCY_LOG`.

## Current state

This repository is at **Phase 3–6 authentication preflight**.

- Google Sheets contract is defined.
- Repository authentication preflight is implemented.
- Regression tests protect against the v3.4 navigation false positives.
- Authentication now uses **Google Workload Identity Federation (WIF)** instead of a long-lived service-account JSON key.
- Crawling remains intentionally disabled until the Phase 7 router is implemented and accepted.

## Why keyless authentication

The Google Cloud organization policy `iam.disableServiceAccountKeyCreation` prevents creation of service-account JSON keys. WIF is the preferred replacement: GitHub Actions presents a short-lived OpenID Connect identity token to Google, Google verifies the repository identity, and the workflow temporarily impersonates the existing `vacancy-monitor` service account. No private key is stored in GitHub.

## Required GitHub Actions variables

Create these under **Settings → Secrets and variables → Actions → Variables**:

- `WIF_PROVIDER` — full Workload Identity Provider resource name.
- `WIF_SERVICE_ACCOUNT` — `vacancy-monitor@project-971fb5f9-f8e1-41d2-93e.iam.gserviceaccount.com`.
- `SPREADSHEET_ID` — `1g_2mRUa8M7DouWljcZyDuj_oLKdZiyLHS5SeBOTbVOE`.

No `GOOGLE_SERVICE_ACCOUNT_JSON` secret is required.

## Run the preflight

Open **Actions → Vacancy Monitor v4 — Preflight → Run workflow**.

Success means:

1. GitHub receives an OIDC identity token;
2. Google accepts it through the configured WIF provider;
3. the workflow impersonates the dedicated service account;
4. dependencies install and regression tests pass;
5. the service account can open the workbook;
6. `URL_MASTER` matches the v4 schema;
7. the three proof-of-concept institutions exist;
8. `CONFIG → MIGRATION_STATE` becomes `GITHUB_SHEETS_AUTH_OK`.

No website crawling occurs during preflight.
