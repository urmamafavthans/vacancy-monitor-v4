export const SHEETS = Object.freeze({
  URL_MASTER: 'URL_MASTER',
  VACANCY_LOG: 'VACANCY_LOG',
  DIAGNOSTICS: 'SCAN_DIAGNOSTICS',
  CONFIG: 'CONFIG',
});

export const URL_MASTER_HEADERS = Object.freeze([
  'Enabled',
  'Institution',
  'Entry URL',
  'Strategy',
  'Crawl Depth',
  'Resolved Vacancy URL',
  'Allowed Domain',
  'Job URL Pattern',
  'Adapter',
  'Last Checked',
  'Status',
  'Active Vacancies',
  'Notes',
  'City',
  'Travel Time (min)',
]);

export const POC_INSTITUTIONS = new Set([
  'Kunstinstituut Melly',
  'Kunsthal Rotterdam',
  'Nieuwe Instituut | Huis Sonneveld',
]);
