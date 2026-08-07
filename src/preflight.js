import {
  createSheetsClient,
  getWorkbookMetadata,
  readUrlMaster,
  setConfigValue,
} from './sheets.js';
import { POC_INSTITUTIONS } from './config.js';

async function main() {
  const client = await createSheetsClient();
  const metadata = await getWorkbookMetadata(client);
  const sources = await readUrlMaster(client);

  const sheetNames = new Set((metadata.sheets ?? []).map((sheet) => sheet.properties?.title));
  const requiredSheets = ['URL_MASTER', 'VACANCY_LOG', 'SCAN_DIAGNOSTICS', 'CONFIG'];
  const missing = requiredSheets.filter((name) => !sheetNames.has(name));
  if (missing.length) throw new Error(`Missing required sheet tabs: ${missing.join(', ')}`);

  const poc = sources.filter((source) => POC_INSTITUTIONS.has(source.institution));
  if (poc.length !== POC_INSTITUTIONS.size) {
    throw new Error(`Expected ${POC_INSTITUTIONS.size} proof-of-concept sources, found ${poc.length}.`);
  }

  await setConfigValue(client, 'MIGRATION_STATE', 'GITHUB_SHEETS_AUTH_OK');

  console.log(`Workbook: ${metadata.properties?.title}`);
  console.log(`Timezone: ${metadata.properties?.timeZone}`);
  console.log(`URL_MASTER records: ${sources.length}`);
  console.log(`Enabled records: ${sources.filter((s) => s.enabled).length}`);
  console.log(`POC sources found: ${poc.map((s) => s.institution).join(' | ')}`);
  console.log('Preflight succeeded. No crawling was performed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
