import { POC_INSTITUTIONS, SHEETS } from './config.js';
import { createSheetsClient, readUrlMaster, setConfigValue, spreadsheetId } from './sheets.js';

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch { return clean(value); }
}
function comparable(value) { return clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' '); }
function corruptTitle(title, institution) {
  const value = clean(title);
  if (!value || value.length > 160) return true;
  if (/\.css-|@media|font-size\s*:|line-height\s*:|font-family\s*:|\{[^}]*\}/i.test(value)) return true;
  if (/\bvacature\b/i.test(value)) return true;
  if (comparable(value) === comparable(institution)) return true;
  return false;
}
function allowedRejection(reason) {
  return /excluded employment type|volunteer-only title/i.test(clean(reason));
}
async function readRange(client, range) {
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range, valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}
async function readConfig(client) {
  const rows = await readRange(client, `${SHEETS.CONFIG}!A1:B100`);
  return new Map(rows.map((row) => [clean(row[0]), clean(row[1])]).filter(([key]) => key));
}

async function main() {
  const runId = clean(process.env.GITHUB_RUN_ID);
  if (!runId) throw new Error('POC review requires GITHUB_RUN_ID.');
  const client = await createSheetsClient();
  const config = await readConfig(client);
  const diagnostics = await readRange(client, `${SHEETS.DIAGNOSTICS}!A1:L10000`);
  const current = diagnostics.slice(1).filter((row) => clean(row[1]) === runId);
  const sources = (await readUrlMaster(client)).filter((source) => source.enabled);
  const logRows = (await readRange(client, `${SHEETS.VACANCY_LOG}!A1:Q5000`)).slice(1).filter((row) => row.some((cell) => clean(cell)));
  const failures = [];

  if (!current.length) failures.push(`No SCAN_DIAGNOSTICS rows found for run ${runId}.`);
  const unexpected = sources.filter((source) => !POC_INSTITUTIONS.has(source.institution));
  const missing = [...POC_INSTITUTIONS].filter((name) => !sources.some((source) => source.institution === name));
  if (sources.length !== POC_INSTITUTIONS.size || unexpected.length || missing.length) failures.push(`POC source gate changed: enabled=${sources.map((s) => s.institution).join(' | ')}; missing=${missing.join(' | ') || 'none'}; unexpected=${unexpected.map((s) => s.institution).join(' | ') || 'none'}.`);

  const currentVerifiedUrls = new Map();
  for (const source of sources) {
    const rows = current.filter((row) => clean(row[2]) === source.institution);
    const entry = rows.find((row) => clean(row[7]) === 'ENTRY' && clean(row[9]) === 'VERIFIED');
    if (!entry) failures.push(`${source.institution}: ENTRY was not VERIFIED.`);
    const jobs = rows.filter((row) => clean(row[7]) === 'JOB');
    const sourceSummary = rows.find((row) => clean(row[7]) === 'SOURCE');
    if (!jobs.length) {
      if (!(sourceSummary && clean(sourceSummary[9]) === 'VERIFIED' && /zero vacancies/i.test(clean(sourceSummary[10])))) failures.push(`${source.institution}: no JOB candidates and no verified zero-vacancy state.`);
      if (source.activeVacancies !== 0) failures.push(`${source.institution}: URL_MASTER Active Vacancies=${source.activeVacancies}, expected 0.`);
      continue;
    }

    for (const row of jobs) {
      const title = clean(row[5]); const url = canonicalUrl(row[6]); const decision = clean(row[9]); const reason = clean(row[10]);
      if (decision === 'ERROR' || decision === 'AMBIGUOUS') failures.push(`${source.institution}: ${decision} candidate ${title || url}.`);
      if (decision === 'REJECTED' && !allowedRejection(reason)) failures.push(`${source.institution}: unexpected rejection for ${title || url}: ${reason}.`);
      if ((decision === 'VERIFIED' || decision === 'REJECTED') && corruptTitle(title, source.institution)) failures.push(`${source.institution}: corrupt/non-canonical title "${title}".`);
      if (decision === 'VERIFIED') {
        if (!url) failures.push(`${source.institution}: VERIFIED candidate missing URL.`);
        const key = `${source.institution}\n${url}`;
        if (currentVerifiedUrls.has(key)) failures.push(`${source.institution}: duplicate VERIFIED candidate URL ${url}.`);
        currentVerifiedUrls.set(key, title);
      }
    }
    const verifiedCount = jobs.filter((row) => clean(row[9]) === 'VERIFIED').length;
    if (source.activeVacancies !== verifiedCount) failures.push(`${source.institution}: URL_MASTER Active Vacancies=${source.activeVacancies}, current VERIFIED jobs=${verifiedCount}.`);
  }

  const pocLogByUrl = new Map();
  for (const row of logRows) {
    const institution = clean(row[2]);
    if (!POC_INSTITUTIONS.has(institution)) continue;
    const title = clean(row[3]); const url = canonicalUrl(row[5]); const status = clean(row[14]);
    if (status !== 'VERIFIED') continue;
    if (corruptTitle(title, institution)) failures.push(`${institution}: VACANCY_LOG contains corrupt/non-canonical title "${title}".`);
    const key = `${institution}\n${url}`;
    const list = pocLogByUrl.get(key) ?? [];
    list.push(row); pocLogByUrl.set(key, list);
  }
  for (const [key, rows] of pocLogByUrl) if (rows.length > 1) failures.push(`VACANCY_LOG contains ${rows.length} VERIFIED rows for ${key.replace('\n', ' / ')}.`);
  for (const [key, title] of currentVerifiedUrls) {
    const matches = pocLogByUrl.get(key) ?? [];
    if (matches.length !== 1) failures.push(`Current VERIFIED job ${key.replace('\n', ' / ')} has ${matches.length} matching VACANCY_LOG rows.`);
    else if (comparable(matches[0][3]) !== comparable(title)) failures.push(`VACANCY_LOG title mismatch for ${key.replace('\n', ' / ')}: diagnostic="${title}", log="${clean(matches[0][3])}".`);
  }

  if (failures.length) {
    await setConfigValue(client, 'POC_CLEAN_STREAK', '0');
    await setConfigValue(client, 'MIGRATION_STATE', 'POC_FIX_REQUIRED');
    console.error(`POC acceptance: FAIL (${failures.length} issue(s)); clean streak reset to 0.`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  const previousStreak = Math.max(0, Number(config.get('POC_CLEAN_STREAK') || 0) || 0);
  const cleanStreak = previousStreak + 1;
  await setConfigValue(client, 'POC_CLEAN_STREAK', String(cleanStreak));
  if (cleanStreak < 2) {
    await setConfigValue(client, 'MIGRATION_STATE', 'POC_CLEAN_PASS_1');
    console.log(`POC acceptance: CLEAN PASS 1/2. ${currentVerifiedUrls.size} current paid vacancy record(s) verified. One more consecutive clean live run is required.`);
    return;
  }
  await setConfigValue(client, 'MIGRATION_STATE', 'POC_ACCEPTED');
  console.log(`POC acceptance: PASS ${cleanStreak}/2. ${currentVerifiedUrls.size} current paid vacancy record(s) verified across ${sources.length} POC sources with consecutive-run stability.`);
}

main().catch(async (error) => {
  console.error(error?.stack || error?.message || String(error));
  try {
    const client = await createSheetsClient();
    await setConfigValue(client, 'POC_CLEAN_STREAK', '0');
    await setConfigValue(client, 'MIGRATION_STATE', 'POC_REVIEW_ERROR');
  } catch {}
  process.exitCode = 1;
});
