import { createSheetsClient, readUrlMaster } from './sheets.js';

async function main() {
  const client = await createSheetsClient();
  const sources = await readUrlMaster(client);
  const enabled = sources.filter((source) => source.enabled);

  console.log(`Vacancy Monitor v4 scaffold loaded.`);
  console.log(`Enabled sources: ${enabled.length}`);
  console.log('Crawling is intentionally disabled until the Phase 7 ENTRY→SOURCE→JOB router is implemented and accepted.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
