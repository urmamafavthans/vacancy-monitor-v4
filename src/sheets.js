import { google } from 'googleapis';
import { SHEETS, URL_MASTER_HEADERS } from './config.js';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseServiceAccountJson() {
  const raw = requiredEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
  }
}

export function spreadsheetId() {
  return requiredEnv('SPREADSHEET_ID');
}

export async function createSheetsClient() {
  const credentials = parseServiceAccountJson();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function getWorkbookMetadata(client) {
  const { data } = await client.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: 'properties(title,timeZone,locale),sheets.properties(title,sheetId)',
  });
  return data;
}

export async function readUrlMaster(client) {
  const { data } = await client.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEETS.URL_MASTER}!A1:O500`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = data.values ?? [];
  if (!rows.length) throw new Error('URL_MASTER is empty.');
  assertV4Schema(rows[0]);

  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row, index) => ({
      rowNumber: index + 2,
      enabled: String(row[0] ?? '').trim().toLowerCase() === 'yes',
      institution: String(row[1] ?? '').trim(),
      entryUrl: String(row[2] ?? '').trim(),
      strategy: String(row[3] ?? 'AUTO').trim() || 'AUTO',
      crawlDepth: Number(row[4] ?? 2) || 2,
      resolvedVacancyUrl: String(row[5] ?? '').trim(),
      allowedDomain: String(row[6] ?? '').trim(),
      jobUrlPattern: String(row[7] ?? '').trim(),
      adapter: String(row[8] ?? 'AUTO').trim() || 'AUTO',
      lastChecked: String(row[9] ?? '').trim(),
      status: String(row[10] ?? '').trim(),
      activeVacancies: Number(row[11] ?? 0) || 0,
      notes: String(row[12] ?? '').trim(),
      city: String(row[13] ?? '').trim(),
      travelTimeMinutes: String(row[14] ?? '').trim(),
    }));
}

export function assertV4Schema(actualHeaders) {
  const actual = URL_MASTER_HEADERS.map((_, i) => String(actualHeaders[i] ?? '').trim());
  const differences = URL_MASTER_HEADERS
    .map((expected, i) => ({ expected, actual: actual[i], column: i + 1 }))
    .filter(({ expected, actual }) => expected !== actual);
  if (differences.length) {
    const detail = differences
      .map((d) => `col ${d.column}: expected "${d.expected}", got "${d.actual}"`)
      .join('; ');
    throw new Error(`URL_MASTER does not match the v4 schema: ${detail}`);
  }
}

export async function setConfigValue(client, key, value) {
  const { data } = await client.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEETS.CONFIG}!A1:B100`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = data.values ?? [];
  const rowIndex = rows.findIndex((row) => String(row[0] ?? '').trim() === key);
  if (rowIndex < 0) throw new Error(`CONFIG key not found: ${key}`);

  await client.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${SHEETS.CONFIG}!B${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

export async function appendDiagnostics(client, rows) {
  if (!rows.length) return;
  await client.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${SHEETS.DIAGNOSTICS}!A:L`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

export async function updateSourceStatus(client, source, patch) {
  const values = [[
    patch.lastChecked ?? '',
    patch.status ?? '',
    patch.activeVacancies ?? 0,
    patch.notes ?? '',
  ]];
  await client.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${SHEETS.URL_MASTER}!J${source.rowNumber}:M${source.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}
