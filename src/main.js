import { scanRunContext, selectRunSources } from './config.js';
import { diagnosticRow } from './diagnostics.js';
import { resolveVacancySource } from './discovery.js';
import { EXPANSION_STATES, expansionCounts, resultSignature, selectActiveBatch, selectNextBatch, transitionExpansionSource } from './expansion-state.js';
import { extractCandidates } from './extract.js';
import { loadPages } from './loader.js';
import { normalizeVerifiedVacancy } from './normalize.js';
import { appendDiagnostics, createSheetsClient, ensureExpansionColumns, readConfig, readUrlMaster, setConfigValue, setConfigValues, updateExpansionSources, updateResolvedSource, updateSourceStatus, upsertVerifiedVacancies } from './sheets.js';
import { verifyJobPage } from './verify.js';

function sameUrl(a, b) { try { const x = new URL(a); const y = new URL(b); x.hash = ''; y.hash = ''; return x.toString().replace(/\/$/, '') === y.toString().replace(/\/$/, ''); } catch { return a === b; } }
function errorText(error) { return error?.stack || error?.message || String(error); }
function explicitlyZeroVacancies(page) {
  const text = String(page?.text || '').replace(/\s+/g, ' ').trim();
  return /(?:there (?:are|is) (?:currently |at the moment )?no vacancies|at the moment,? there are no vacancies|currently no vacancies|no current vacancies|momenteel geen vacatures|op dit moment (?:zijn er )?geen vacatures|er zijn momenteel geen vacatures)/i.test(text);
}

function applyControlPatch(source, patch) {
  Object.assign(source, patch);
  if (patch.enabled !== undefined) source.enabled = patch.enabled;
}

function progressConfig(sources, context, state) {
  const counts = expansionCounts(sources);
  return {
    MIGRATION_STATE: state,
    EXPANSION_AUTOMATION_STATE: state.includes('COMPLETE') ? 'COMPLETE' : 'RUNNING',
    EXPANSION_BATCH_SIZE: String(context.batchSize),
    EXPANSION_MAX_ATTEMPTS: String(context.maxAttempts),
    EXPANSION_INTERVAL_MINUTES: '30',
    EXPANSION_PENDING_COUNT: String(counts.pending),
    EXPANSION_TESTING_COUNT: String(counts.testing),
    EXPANSION_VALIDATED_COUNT: String(counts.validated),
    EXPANSION_BLOCKED_COUNT: String(counts.blocked),
    EXPANSION_FINAL_REPORTED: 'No',
  };
}

async function prepareAutomatedExpansion(client, context) {
  await ensureExpansionColumns(client);
  const config = await readConfig(client);
  let sources = await readUrlMaster(client);
  if (config.get('EXPANSION_AUTOMATION_STATE') === 'COMPLETE') return { complete: true, sources, active: [] };

  const isFreshController = sources.every((source) => !source.expansionState);
  if (isFreshController) {
    if (config.get('MIGRATION_STATE') !== 'EXPANSION_BATCH_1_ACCEPTED') throw new Error('Expansion bootstrap refused: Batch 1 acceptance is not recorded in CONFIG.');
    const accepted = sources.filter((source) => source.enabled);
    if (!accepted.length || accepted.length > context.batchSize) throw new Error(`Expansion bootstrap refused: expected 1-${context.batchSize} accepted enabled sources, found ${accepted.length}.`);
    const acceptedRows = new Set(accepted.map((source) => source.rowNumber));
    const patches = sources.map((source) => ({
      source,
      patch: acceptedRows.has(source.rowNumber)
        ? { expansionState: EXPANSION_STATES.VALIDATED, cleanStreak: 2, attempts: 0, resultSignature: '', lastValidationRun: source.lastChecked, blockerReason: '' }
        : { expansionState: EXPANSION_STATES.PENDING, cleanStreak: 0, attempts: 0, resultSignature: '', lastValidationRun: '', blockerReason: '' },
    }));
    await updateExpansionSources(client, patches);
    for (const { source, patch } of patches) applyControlPatch(source, patch);
  }

  let active = selectActiveBatch(sources, context.batchSize);
  if (!active.length) {
    const next = selectNextBatch(sources, context.batchSize);
    if (!next.length) {
      const counts = expansionCounts(sources);
      const state = counts.blocked ? 'EXPANSION_VALIDATION_COMPLETE_WITH_BLOCKERS' : 'EXPANSION_VALIDATION_COMPLETE';
      await setConfigValues(client, progressConfig(sources, context, state));
      return { complete: true, sources, active: [] };
    }
    const patches = next.map((source) => ({ source, patch: { enabled: true, expansionState: EXPANSION_STATES.TESTING, cleanStreak: 0, attempts: 0, resultSignature: '', lastValidationRun: '', blockerReason: '' } }));
    await updateExpansionSources(client, patches);
    for (const { source, patch } of patches) applyControlPatch(source, patch);
    active = next;
  }

  await setConfigValues(client, {
    ...progressConfig(sources, context, 'EXPANSION_AUTOMATED_RUNNING'),
    EXPANSION_ACTIVE_BATCH: active.map((source) => source.institution).join(' | '),
  });
  return { complete: false, sources, active };
}

async function finishAutomatedRun(client, sources, active, results, context, runId) {
  const patches = active.map((source) => {
    const result = results.get(source.rowNumber) || { clean: false, signature: resultSignature(['missing-result']), reason: 'No terminal result was recorded for this source' };
    return { source, patch: { ...transitionExpansionSource(source, result, { requiredCleanRuns: 2, maxAttempts: context.maxAttempts }), lastValidationRun: runId } };
  });
  await updateExpansionSources(client, patches);
  for (const { source, patch } of patches) applyControlPatch(source, patch);

  if (!selectActiveBatch(sources, context.batchSize).length) {
    const next = selectNextBatch(sources, context.batchSize);
    if (next.length) {
      const nextPatches = next.map((source) => ({ source, patch: { enabled: true, expansionState: EXPANSION_STATES.TESTING, cleanStreak: 0, attempts: 0, resultSignature: '', lastValidationRun: '', blockerReason: '' } }));
      await updateExpansionSources(client, nextPatches);
      for (const { source, patch } of nextPatches) applyControlPatch(source, patch);
    }
  }

  const counts = expansionCounts(sources);
  const complete = counts.pending === 0 && counts.testing === 0;
  const state = complete ? (counts.blocked ? 'EXPANSION_VALIDATION_COMPLETE_WITH_BLOCKERS' : 'EXPANSION_VALIDATION_COMPLETE') : 'EXPANSION_AUTOMATED_RUNNING';
  await setConfigValues(client, {
    ...progressConfig(sources, context, state),
    EXPANSION_ACTIVE_BATCH: sources.filter((source) => source.expansionState === EXPANSION_STATES.TESTING).map((source) => source.institution).join(' | '),
  });
  return { complete, counts };
}

async function main() {
  const client = await createSheetsClient();
  const context = scanRunContext();
  let sources;
  let enabled;
  if (context.autoExpansion) {
    const prepared = await prepareAutomatedExpansion(client, context);
    if (prepared.complete) { console.log('Automated expansion is complete; scheduled run exits without scanning.'); return; }
    sources = prepared.sources;
    enabled = prepared.active;
  } else {
    sources = await readUrlMaster(client);
    enabled = selectRunSources(sources, context);
  }

  const runTime = new Date().toISOString();
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const diagnostics = [];
  const verifiedRows = [];
  const results = new Map();
  let technicalErrors = 0;
  console.log(`Vacancy Monitor v4 ${context.label}: ${enabled.length} source(s).`);

  for (const source of enabled) {
    console.log(`\n[${source.institution}] ENTRY ${source.entryUrl}`);
    await updateSourceStatus(client, source, { lastChecked: runTime, status: source.status || 'Not checked', activeVacancies: source.activeVacancies, notes: 'Automated expansion scan started' });
    try {
      const resolution = await resolveVacancySource(source, loadPages);
      if (!resolution.resolvedUrl) {
        const error = resolution.method === 'ENTRY_ERROR';
        if (error) technicalErrors += 1;
        const decision = error ? 'ERROR' : 'AMBIGUOUS';
        const reason = 'No confirmed vacancy source resolved';
        diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, route: 'ENTRY', extractionMethod: resolution.method, decision, reason, evidence: resolution.trace.join(' | ') }));
        results.set(source.rowNumber, { clean: false, signature: resultSignature([resolution.method, ...resolution.trace]), reason: `${reason}: ${resolution.trace.join(' | ')}`.slice(0, 500) });
        await updateSourceStatus(client, source, { lastChecked: runTime, status: error ? 'Error' : 'Needs adapter', activeVacancies: 0, notes: `${resolution.method}: ${resolution.trace.join(' | ')}`.slice(0, 1000) });
        continue;
      }

      const resolvedUrl = resolution.resolvedUrl;
      const sourcePage = resolution.page;
      await updateResolvedSource(client, source, resolvedUrl);
      diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl, route: 'ENTRY', extractionMethod: resolution.method, decision: 'VERIFIED', reason: 'Vacancy source resolved', evidence: resolution.trace.join(' | ') }));
      console.log(`[${source.institution}] SOURCE ${resolvedUrl} via ${resolution.method}`);
      const candidates = extractCandidates(sourcePage, source);
      console.log(`[${source.institution}] candidates=${candidates.length}`);

      if (!candidates.length) {
        const zeroState = explicitlyZeroVacancies(sourcePage);
        const decision = zeroState ? 'VERIFIED' : 'AMBIGUOUS';
        const reason = zeroState ? 'Confirmed vacancy source explicitly reports zero vacancies' : 'Confirmed vacancy source contained no extractable job candidates';
        diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl, route: 'SOURCE', extractionMethod: sourcePage.method, decision, reason, evidence: zeroState ? 'explicit zero-vacancy statement' : `source loader=${sourcePage.method}` }));
        results.set(source.rowNumber, { clean: zeroState, signature: resultSignature([resolvedUrl, decision, 'zero-candidates']), reason });
        await updateSourceStatus(client, source, { lastChecked: runTime, status: zeroState ? 'No vacancies found' : 'Needs adapter', activeVacancies: 0, notes: `${resolution.method}; source=${resolvedUrl}` });
        continue;
      }

      const detailUrls = [...new Set(candidates.filter((candidate) => !sameUrl(candidate.url, resolvedUrl)).map((candidate) => candidate.url))].slice(0, 25);
      const detailPages = await loadPages(detailUrls);
      const candidateResults = [];
      let sourceVerified = 0;
      for (const candidate of candidates) {
        const page = sameUrl(candidate.url, resolvedUrl) ? sourcePage : detailPages.get(candidate.url);
        const verification = verifyJobPage(candidate, page);
        const displayTitle = verification.title || candidate.title;
        candidateResults.push(`${verification.decision}|${displayTitle}|${candidate.url}`);
        diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, resolvedSourceUrl: resolvedUrl, candidateTitle: displayTitle, candidateUrl: candidate.url, route: 'JOB', extractionMethod: `${candidate.method}/${page?.method || 'NO_PAGE'}`, decision: verification.decision, reason: verification.reason, evidence: verification.evidence }));
        console.log(`[${source.institution}] ${verification.decision}: ${displayTitle}`);
        if (verification.decision === 'ERROR') technicalErrors += 1;
        if (verification.decision === 'VERIFIED') { sourceVerified += 1; verifiedRows.push(normalizeVerifiedVacancy(candidate, source, verification, runTime)); }
      }
      const unresolved = candidateResults.filter((line) => /^(?:AMBIGUOUS|ERROR)\|/.test(line));
      const clean = unresolved.length === 0;
      const reason = clean ? `All ${candidates.length} candidate(s) accounted for` : `${unresolved.length} candidate(s) remain ambiguous or errored`;
      results.set(source.rowNumber, { clean, signature: resultSignature([resolvedUrl, ...candidateResults]), reason });
      await updateSourceStatus(client, source, { lastChecked: runTime, status: clean ? (sourceVerified ? 'OK' : 'No vacancies found') : 'Needs adapter', activeVacancies: sourceVerified, notes: `${resolution.method}; candidates=${candidates.length}; verified=${sourceVerified}; source=${resolvedUrl}`.slice(0, 1000) });
    } catch (error) {
      technicalErrors += 1;
      const message = errorText(error);
      diagnostics.push(diagnosticRow({ runTime, runId, institution: source.institution, entryUrl: source.entryUrl, route: 'SYSTEM', extractionMethod: 'EXCEPTION', decision: 'ERROR', reason: 'Unhandled source error', evidence: message }));
      results.set(source.rowNumber, { clean: false, signature: resultSignature(['EXCEPTION', message]), reason: message.slice(0, 500) });
      await updateSourceStatus(client, source, { lastChecked: runTime, status: 'Error', activeVacancies: 0, notes: message.slice(0, 1000) });
    }
  }

  const upsert = await upsertVerifiedVacancies(client, verifiedRows);
  await appendDiagnostics(client, diagnostics);
  if (context.autoExpansion) {
    const progress = await finishAutomatedRun(client, sources, enabled, results, context, runId);
    console.log(`Expansion progress: validated=${progress.counts.validated}, blocked=${progress.counts.blocked}, pending=${progress.counts.pending}, testing=${progress.counts.testing}`);
  } else {
    await setConfigValue(client, 'MIGRATION_STATE', technicalErrors ? `${context.statePrefix}_SCAN_COMPLETE_WITH_ERRORS` : `${context.statePrefix}_SCAN_COMPLETE_REVIEW_REQUIRED`);
  }
  console.log(`\nVerified vacancies: ${verifiedRows.length}`);
  console.log(`VACANCY_LOG inserted=${upsert.inserted}, updated=${upsert.updated}`);
  console.log(`Diagnostics rows: ${diagnostics.length}`);
  console.log(`Technical errors: ${technicalErrors}`);
  if (technicalErrors) throw new Error(`${context.label} completed with ${technicalErrors} technical error(s). Review SCAN_DIAGNOSTICS.`);
}

main().catch((error) => { console.error(errorText(error)); process.exitCode = 1; });
