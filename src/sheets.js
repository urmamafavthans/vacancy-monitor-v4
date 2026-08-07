import { google } from 'googleapis';
import { EXPANSION_HEADERS, SHEETS, URL_MASTER_HEADERS, VACANCY_LOG_HEADERS } from './config.js';
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
export function spreadsheetId() { return requiredEnv('SPREADSHEET_ID'); }
export async function createSheetsClient() { const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }); return google.sheets({ version: 'v4', auth }); }
export async function getWorkbookMetadata(client) { const { data } = await client.spreadsheets.get({ spreadsheetId: spreadsheetId(), fields: 'properties(title,timeZone,locale),sheets.properties(title,sheetId)' }); return data; }
export function assertV4Schema(actualHeaders) {
  const actual = URL_MASTER_HEADERS.map((_, i) => String(actualHeaders[i] ?? '').trim());
  const differences = URL_MASTER_HEADERS.map((expected, i) => ({ expected, actual: actual[i], column: i + 1 })).filter(({ expected, actual }) => expected !== actual);
  if (differences.length) throw new Error(`URL_MASTER does not match the v4 schema: ${differences.map((d) => `col ${d.column}: expected "${d.expected}", got "${d.actual}"`).join('; ')}`);
}
function assertVacancyLogSchema(actualHeaders) {
  const differences = VACANCY_LOG_HEADERS.map((expected, i) => ({ expected, actual: String(actualHeaders[i] ?? '').trim(), column: i + 1 })).filter(({ expected, actual }) => expected !== actual);
  if (differences.length) throw new Error(`VACANCY_LOG does not match the v4 schema: ${differences.map((d) => `col ${d.column}: expected "${d.expected}", got "${d.actual}"`).join('; ')}`);
}
export async function readUrlMaster(client) {
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${SHEETS.URL_MASTER}!A1:U500`, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = data.values ?? []; if (!rows.length) throw new Error('URL_MASTER is empty.'); assertV4Schema(rows[0]);
  return rows.slice(1).map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) => row.some((cell) => String(cell ?? '').trim() !== '')).map(({ row, rowNumber }) => ({
    rowNumber, enabled: String(row[0] ?? '').trim().toLowerCase() === 'yes', institution: String(row[1] ?? '').trim(), entryUrl: String(row[2] ?? '').trim(), strategy: String(row[3] ?? 'AUTO').trim() || 'AUTO', crawlDepth: Number(row[4] ?? 2) || 2, resolvedVacancyUrl: String(row[5] ?? '').trim(), allowedDomain: String(row[6] ?? '').trim(), jobUrlPattern: String(row[7] ?? '').trim(), adapter: String(row[8] ?? 'AUTO').trim() || 'AUTO', lastChecked: String(row[9] ?? '').trim(), status: String(row[10] ?? '').trim(), activeVacancies: Number(row[11] ?? 0) || 0, notes: String(row[12] ?? '').trim(), city: String(row[13] ?? '').trim(), travelTimeMinutes: String(row[14] ?? '').trim(), expansionState: String(row[15] ?? '').trim().toUpperCase(), cleanStreak: Number(row[16] ?? 0) || 0, attempts: Number(row[17] ?? 0) || 0, resultSignature: String(row[18] ?? '').trim(), lastValidationRun: String(row[19] ?? '').trim(), blockerReason: String(row[20] ?? '').trim(),
  }));
}
export async function readConfig(client) {
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${SHEETS.CONFIG}!A1:B100`, valueRenderOption: 'FORMATTED_VALUE' });
  return new Map((data.values ?? []).filter((row) => String(row[0] ?? '').trim()).map((row) => [String(row[0]).trim(), String(row[1] ?? '').trim()]));
}
export async function setConfigValues(client, entries) {
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${SHEETS.CONFIG}!A1:B100`, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = data.values ?? []; let nextRow = Math.max(4, rows.length + 1); const updates = [];
  for (const [key, value] of Object.entries(entries)) {
    const rowIndex = rows.findIndex((row) => String(row[0] ?? '').trim() === key);
    if (rowIndex >= 0) updates.push({ range: `${SHEETS.CONFIG}!B${rowIndex + 1}`, values: [[value]] });
    else { updates.push({ range: `${SHEETS.CONFIG}!A${nextRow}:B${nextRow}`, values: [[key, value]] }); nextRow += 1; }
  }
  if (updates.length) await client.spreadsheets.values.batchUpdate({ spreadsheetId: spreadsheetId(), requestBody: { valueInputOption: 'RAW', data: updates } });
}
export async function setConfigValue(client, key, value) { await setConfigValues(client, { [key]: value }); }
export async function ensureExpansionColumns(client) {
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${SHEETS.URL_MASTER}!P1:U1`, valueRenderOption: 'FORMATTED_VALUE' });
  const actual = data.values?.[0] ?? [];
  if (EXPANSION_HEADERS.every((header, index) => String(actual[index] ?? '').trim() === header)) return;
  if (actual.some((cell) => String(cell ?? '').trim())) throw new Error('URL_MASTER P:U contains unexpected data; expansion controller will not overwrite it.');
  await client.spreadsheets.values.update({ spreadsheetId: spreadsheetId(), range: `${SHEETS.URL_MASTER}!P1:U1`, valueInputOption: 'RAW', requestBody: { values: [EXPANSION_HEADERS] } });
  const metadata = await client.spreadsheets.get({ spreadsheetId: spreadsheetId(), fields: 'sheets.properties(title,sheetId)' });
  const sheetId = metadata.data.sheets.find((sheet) => sheet.properties.title === SHEETS.URL_MASTER)?.properties.sheetId;
  await client.spreadsheets.batchUpdate({ spreadsheetId: spreadsheetId(), requestBody: { requests: [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 15, endColumnIndex: 21 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { bold: true } } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat.bold)' } },
    { setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 15, endColumnIndex: 16 }, rule: { condition: { type: 'ONE_OF_LIST', values: ['PENDING','TESTING','VALIDATED','BLOCKED'].map((userEnteredValue) => ({ userEnteredValue })) }, showCustomUi: true, strict: true } } },
  ] } });
}
export async function updateExpansionSources(client, patches) {
  const data = [];
  for (const { source, patch } of patches) {
    if (patch.enabled !== undefined) data.push({ range: `${SHEETS.URL_MASTER}!A${source.rowNumber}`, values: [[patch.enabled ? 'Yes' : 'No']] });
    data.push({ range: `${SHEETS.URL_MASTER}!P${source.rowNumber}:U${source.rowNumber}`, values: [[patch.expansionState ?? source.expansionState ?? '', patch.cleanStreak ?? source.cleanStreak ?? 0, patch.attempts ?? source.attempts ?? 0, patch.resultSignature ?? source.resultSignature ?? '', patch.lastValidationRun ?? source.lastValidationRun ?? '', patch.blockerReason ?? source.blockerReason ?? '']] });
  }
  if (data.length) await client.spreadsheets.values.batchUpdate({ spreadsheetId: spreadsheetId(), requestBody: { valueInputOption: 'RAW', data } });
}
export async function appendDiagnostics(client, rows) { if (!rows.length) return; await client.spreadsheets.values.append({ spreadsheetId: spreadsheetId(), range: `${SHEETS.DIAGNOSTICS}!A:L`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows } }); }
export async function updateResolvedSource(client, source, resolvedUrl) { let allowedDomain = ''; try { allowedDomain = new URL(resolvedUrl).hostname; } catch {} await client.spreadsheets.values.update({ spreadsheetId: spreadsheetId(), range: `${SHEETS.URL_MASTER}!F${source.rowNumber}:G${source.rowNumber}`, valueInputOption: 'RAW', requestBody: { values: [[resolvedUrl, allowedDomain]] } }); }
export async function updateSourceStatus(client, source, patch) { await client.spreadsheets.values.update({ spreadsheetId: spreadsheetId(), range: `${SHEETS.URL_MASTER}!J${source.rowNumber}:M${source.rowNumber}`, valueInputOption: 'RAW', requestBody: { values: [[patch.lastChecked ?? '', patch.status ?? '', patch.activeVacancies ?? 0, patch.notes ?? '']] } }); }
export async function upsertVerifiedVacancies(client, vacancies) {
  if (!vacancies.length) return { inserted: 0, updated: 0 };
  const { data } = await client.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${SHEETS.VACANCY_LOG}!A1:Q5000`, valueRenderOption: 'FORMATTED_VALUE' }); const rows = data.values ?? []; if (!rows.length) throw new Error('VACANCY_LOG is empty.'); assertVacancyLogSchema(rows[0]);
  const byFingerprint = new Map();
  const occupiedRows = new Set();
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.some((cell) => String(cell ?? '').trim() !== '')) occupiedRows.add(rowNumber);
    const fp = String(row[15] ?? '').trim(); if (fp) byFingerprint.set(fp, rowNumber);
  });
  function nextAvailableRow() { let row = 2; while (occupiedRows.has(row)) row += 1; occupiedRows.add(row); return row; }
  let inserted = 0; let updated = 0;
  for (const vacancy of vacancies) {
    const rowNumber = byFingerprint.get(vacancy.fingerprint);
    if (rowNumber) {
      await client.spreadsheets.values.update({ spreadsheetId: spreadsheetId(), range: `${SHEETS.VACANCY_LOG}!B${rowNumber}:Q${rowNumber}`, valueInputOption: 'RAW', requestBody: { values: [vacancy.values.slice(1)] } }); updated += 1;
    } else {
      const targetRow = nextAvailableRow();
      await client.spreadsheets.values.update({ spreadsheetId: spreadsheetId(), range: `${SHEETS.VACANCY_LOG}!A${targetRow}:Q${targetRow}`, valueInputOption: 'RAW', requestBody: { values: [vacancy.values] } }); inserted += 1; byFingerprint.set(vacancy.fingerprint, targetRow);
    }
  }
  return { inserted, updated };
}
