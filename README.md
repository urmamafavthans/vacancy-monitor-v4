# Vacancy Monitor v4

Verified vacancy-monitor pipeline using Google Sheets as the control panel and GitHub Actions as the crawler runtime.

## Architecture

`URL_MASTER → ENTRY discovery → confirmed SOURCE → candidate extraction → independent JOB verification → VACANCY_LOG`

Every extracted candidate is accounted for in `SCAN_DIAGNOSTICS` as `VERIFIED`, `REJECTED`, `AMBIGUOUS`, or `ERROR`. Only `VERIFIED` jobs enter `VACANCY_LOG`.

## Current stage: three-source POC

Authentication preflight is complete using GitHub OIDC + Google Workload Identity Federation. No long-lived Google service-account key is stored.

The first crawler acceptance set contains only:

- Kunstinstituut Melly
- Kunsthal Rotterdam
- Nieuwe Instituut | Huis Sonneveld

All other sources remain disabled until the POC is reviewed.

### Routing rules

- **ENTRY** may discover and cache a vacancy/careers source. It cannot create job records.
- **SOURCE** extracts candidates only from a confirmed vacancy source using JobPosting data, ATS/detail links, explicit job URL patterns, or tightly isolated inline job blocks.
- **JOB** loads and verifies each candidate independently. A job needs vacancy identity proof and employment evidence.
- Internships, traineeships, unpaid/volunteer-only roles, and open applications are excluded.

### Fetch strategy

Crawlee uses `CheerioCrawler` first. `PlaywrightCrawler` is used only when the HTML request fails or the page appears to be a client-rendered app shell.

## Manual POC run

Open **Actions → Vacancy Monitor v4 — POC Scan → Run workflow**.

The workflow installs dependencies and Chromium, runs regression tests first, then scans only the three enabled POC rows. If tests fail, no scan is executed.

A technically green run is not final acceptance. Review `VACANCY_LOG`, `SCAN_DIAGNOSTICS`, and the resolved source/status fields in `URL_MASTER` before expanding the source set.

## Legacy Apps Script

The v3.4 Apps Script crawler is archived. Remove its installable time-driven trigger before operating v4. Keep the script code until v4 is accepted; deleting code is not a substitute for deleting the trigger.
