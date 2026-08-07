# Vacancy Monitor v4

Verified vacancy-monitor pipeline using Google Sheets as the control panel and GitHub Actions as the crawler runtime.

## Architecture

`URL_MASTER → ENTRY discovery → confirmed SOURCE → candidate extraction → independent JOB verification → VACANCY_LOG`

Every extracted candidate is accounted for in `SCAN_DIAGNOSTICS` as `VERIFIED`, `REJECTED`, `AMBIGUOUS`, or `ERROR`. Only `VERIFIED` jobs enter `VACANCY_LOG`.

## Current stage: controlled expansion

Authentication preflight is complete using GitHub OIDC + Google Workload Identity Federation. No long-lived Google service-account key is stored.

The three-source proof of concept is accepted after consecutive clean live runs:

- Kunstinstituut Melly
- Kunsthal Rotterdam
- Nieuwe Instituut | Huis Sonneveld

Expansion Batch 1 added Roodkapje, LUX Nijmegen, and HKU and is accepted.

The unattended expansion controller now advances six sources at a time. A source is validated after two consecutive clean runs with the same result signature. Ambiguous or failed sources retry up to four times, then move to `BLOCKED` while later sources continue. Controller state is stored in `URL_MASTER` columns P:U and summarized in `CONFIG`.

### Routing rules

- **ENTRY** may discover and cache a vacancy/careers source. It cannot create job records.
- **SOURCE** extracts candidates only from a confirmed vacancy source using JobPosting data, ATS/detail links, explicit job URL patterns, or tightly isolated inline job blocks.
- **JOB** loads and verifies each candidate independently. A job needs vacancy identity proof and employment evidence.
- Internships, traineeships, unpaid/volunteer-only roles, and open applications are excluded.

### Fetch strategy

Crawlee uses `CheerioCrawler` first. `PlaywrightCrawler` is used only when the HTML request fails or the page appears to be a client-rendered app shell.

## Workflows

**Vacancy Monitor v4 — Controlled Expansion Scan** runs the active six-source validation batch at minutes 07 and 37 of every hour. Relevant pushes and manual dispatches use the same stateful controller. Workflow concurrency prevents overlapping scans.

**Vacancy Monitor v4 — POC Scan** keeps the accepted three-source set available as a regression check. Pushes run its regression tests only; manual dispatch runs and reviews the three POC sources even while approved expansion rows are enabled.

Both scan paths run regression tests before crawling. If tests fail, no scan is executed.

The controller requires two matching clean scans. Every candidate must be verified or deliberately rejected, and a zero-vacancy result requires an explicit statement on the official source. `AMBIGUOUS` and `ERROR` outcomes cannot increase the clean streak.

## Legacy Apps Script

The v3.4 Apps Script crawler is archived. Remove its installable time-driven trigger before operating v4. Keep the script code until v4 is accepted; deleting code is not a substitute for deleting the trigger.
