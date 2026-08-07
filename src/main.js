import { scanRunContext, selectRunSources } from './config.js';
import { diagnosticRow } from './diagnostics.js';
import { resolveVacancySource } from './discovery.js';
import { extractCandidates } from './extract.js';
import { loadPages } from './loader.js';
import { normalizeVerifiedVacancy } from './normalize.js';
import { appendDiagnostics, createSheetsClient, readUrlMaster, setConfigValue, updateResolvedSource, updateSourceStatus, upsertVerifiedVacancies } from './sheets.js';
import { verifyJobPage } from './verify.js';
function sameUrl(a, b) { try { const x = new URL(a); const y = new URL(b); x.hash = ''; y.hash = ''; return x.toString().replace(/\/$/, '') === y.toString().replace(/\/$/, ''); } catch { return a === b; } }
function errorText(error) { return error?.stack || error?.message || String(error); }
function explicitlyZeroVacancies(page) {
  const text = String(page?.text || '').replace(/\s+/g, ' ').trim();
  return /(?:there (?:are|is) (?:currently |at the moment )?no vacancies|at the moment,? there are no vacancies|currently no vacancies|no current vacancies|momenteel geen vacatures|op dit moment (?:zijn er )?geen vacatures|er zijn momenteel geen vacatures)/i.test(text);
}

async function main() {
  const client = await createSheetsClient(); const sources = await readUrlMaster(client); const context = scanRunContext(); const enabled = selectRunSources(sources, context);
  const runTime = new Date().toISOString(); const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`; const diagnostics = []; const verifiedRows = []; let technicalErrors = 0;
  console.log(`Vacancy Monitor v4 ${context.label}: ${enabled.length} enabled source(s).`);
  for (const source of enabled) {
    console.log(`\n[${source.institution}] ENTRY ${source.entryUrl}`);
    await updateSourceStatus(client, source, { lastChecked: runTime, status: `${context.label} scanning`, activeVacancies: 0, notes: 'ENTRY discovery started' });
    try {
      const resolution = await resolveVacancySource(source, loadPages);
      if (!resolution.resolvedUrl) {
        if (resolution.method === 'ENTRY_ERROR') technicalErrors += 1;
        diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, route: 'ENTRY', extractionMethod: resolution.method, decision: resolution.method === 'ENTRY_ERROR' ? 'ERROR' : 'AMBIGUOUS', reason: 'No confirmed vacancy source resolved', evidence: resolution.trace.join(' | ') }));
        await updateSourceStatus(client, source, { lastChecked: runTime, status: `${context.label} unresolved`, activeVacancies: 0, notes: `${resolution.method}: ${resolution.trace.join(' | ')}`.slice(0, 1000) }); continue;
      }
      const resolvedUrl = resolution.resolvedUrl; const sourcePage = resolution.page; await updateResolvedSource(client, source, resolvedUrl);
      diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl, route: 'ENTRY', extractionMethod: resolution.method, decision: 'VERIFIED', reason: 'Vacancy source resolved', evidence: resolution.trace.join(' | ') }));
      console.log(`[${source.institution}] SOURCE ${resolvedUrl} via ${resolution.method}`);
      const candidates = extractCandidates(sourcePage, source); console.log(`[${source.institution}] candidates=${candidates.length}`);
      if (!candidates.length) {
        const zeroState = explicitlyZeroVacancies(sourcePage);
        diagnostics.push(diagnosticRow({
          runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl,
          route: 'SOURCE', extractionMethod: sourcePage.method,
          decision: zeroState ? 'VERIFIED' : 'AMBIGUOUS',
          reason: zeroState ? 'Confirmed vacancy source explicitly reports zero vacancies' : 'Confirmed vacancy source contained no extractable job candidates',
          evidence: zeroState ? 'explicit zero-vacancy statement' : `source loader=${sourcePage.method}`,
        }));
        await updateSourceStatus(client, source, { lastChecked: runTime, status: zeroState ? `${context.label} checked — zero vacancies` : `${context.label} checked — no candidates`, activeVacancies: 0, notes: `${resolution.method}; source=${resolvedUrl}` }); continue;
      }
      const detailUrls = [...new Set(candidates.filter((candidate) => !sameUrl(candidate.url, resolvedUrl)).map((candidate) => candidate.url))].slice(0, 25); const detailPages = await loadPages(detailUrls); let sourceVerified = 0;
      for (const candidate of candidates) {
        const page = sameUrl(candidate.url, resolvedUrl) ? sourcePage : detailPages.get(candidate.url); const verification = verifyJobPage(candidate, page); const displayTitle = verification.title || candidate.title;
        diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl, candidateTitle: displayTitle, candidateUrl: candidate.url, route: 'JOB', extractionMethod: `${candidate.method}/${page?.method || 'NO_PAGE'}`, decision: verification.decision, reason: verification.reason, evidence: verification.evidence }));
        console.log(`[${source.institution}] ${verification.decision}: ${displayTitle}`);
        if (verification.decision === 'ERROR') technicalErrors += 1;
        if (verification.decision === 'VERIFIED') { sourceVerified += 1; verifiedRows.push(normalizeVerifiedVacancy(candidate, source, verification, runTime)); }
      }
      await updateSourceStatus(client, source, { lastChecked: runTime, status: `${context.label} complete — review required`, activeVacancies: sourceVerified, notes: `${resolution.method}; candidates=${candidates.length}; verified=${sourceVerified}; source=${resolvedUrl}`.slice(0, 1000) });
    } catch (error) {
      technicalErrors += 1; diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, route: 'SYSTEM', extractionMethod: 'EXCEPTION', decision: 'ERROR', reason: 'Unhandled source error', evidence: errorText(error) }));
      await updateSourceStatus(client, source, { lastChecked: runTime, status: `${context.label} error`, activeVacancies: 0, notes: errorText(error).slice(0, 1000) });
    }
  }
  const upsert = await upsertVerifiedVacancies(client, verifiedRows); await appendDiagnostics(client, diagnostics); await setConfigValue(client, 'MIGRATION_STATE', technicalErrors ? `${context.statePrefix}_SCAN_COMPLETE_WITH_ERRORS` : `${context.statePrefix}_SCAN_COMPLETE_REVIEW_REQUIRED`);
  console.log(`\nVerified vacancies: ${verifiedRows.length}`); console.log(`VACANCY_LOG inserted=${upsert.inserted}, updated=${upsert.updated}`); console.log(`Diagnostics rows: ${diagnostics.length}`); console.log(`Technical errors: ${technicalErrors}`);
  if (technicalErrors) throw new Error(`${context.label} completed with ${technicalErrors} technical error(s). Review SCAN_DIAGNOSTICS.`);
}
main().catch((error) => { console.error(errorText(error)); process.exitCode = 1; });
