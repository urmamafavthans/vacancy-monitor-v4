export const SHEETS = Object.freeze({
  URL_MASTER: 'URL_MASTER',
  VACANCY_LOG: 'VACANCY_LOG',
  DIAGNOSTICS: 'SCAN_DIAGNOSTICS',
  CONFIG: 'CONFIG',
});

export const URL_MASTER_HEADERS = Object.freeze([
  'Enabled','Institution','Entry URL','Strategy','Crawl Depth','Resolved Vacancy URL',
  'Allowed Domain','Job URL Pattern','Adapter','Last Checked','Status','Active Vacancies',
  'Notes','City','Travel Time (min)',
]);

export const EXPANSION_HEADERS = Object.freeze([
  'Expansion State','Clean Streak','Attempts','Result Signature','Last Validation Run','Blocker Reason',
]);

export const VACANCY_LOG_HEADERS = Object.freeze([
  'First Seen','Last Seen','Institution','Original Job Title','English Job Title','Vacancy URL',
  'Source URL','City','Date Posted','Closing Date','Weekly Hours','Contract Mode',
  'Position Category','Travel Time (min)','Status','Fingerprint','Notes',
]);

export const POC_INSTITUTIONS = new Set([
  'Kunstinstituut Melly',
  'Kunsthal Rotterdam',
  'Nieuwe Instituut | Huis Sonneveld',
]);

function enabledFlag(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

export function scanRunContext(env = process.env) {
  const pocOnly = enabledFlag(env.POC_ONLY);
  const autoExpansion = enabledFlag(env.AUTO_EXPANSION);
  const batchSize = Math.max(1, Number(env.EXPANSION_BATCH_SIZE || 6));
  const maxAttempts = Math.max(2, Number(env.EXPANSION_MAX_ATTEMPTS || 4));
  return Object.freeze({
    pocOnly,
    autoExpansion,
    batchSize,
    maxAttempts,
    allowAdditionalEnabled: enabledFlag(env.ALLOW_ADDITIONAL_ENABLED),
    label: pocOnly ? 'POC' : autoExpansion ? 'Automated expansion' : 'Expansion',
    statePrefix: pocOnly ? 'POC' : 'EXPANSION',
  });
}

export function selectRunSources(sources, context) {
  if (context.autoExpansion) {
    const active = sources.filter((source) => source.expansionState === 'TESTING');
    if (!active.length) throw new Error('No automated expansion batch is active.');
    if (active.length > context.batchSize) throw new Error(`Expansion safety gate failed: ${active.length} active sources exceed batch size ${context.batchSize}.`);
    return active;
  }
  const enabled = sources.filter((source) => source.enabled);
  if (!enabled.length) throw new Error('No URL_MASTER sources are enabled.');
  if (!context.pocOnly) return enabled;

  const poc = enabled.filter((source) => POC_INSTITUTIONS.has(source.institution));
  const missing = [...POC_INSTITUTIONS].filter((name) => !poc.some((source) => source.institution === name));
  const unexpected = enabled.filter((source) => !POC_INSTITUTIONS.has(source.institution));
  if (missing.length || (!context.allowAdditionalEnabled && (unexpected.length || enabled.length !== POC_INSTITUTIONS.size))) {
    throw new Error(`POC safety gate failed. Enabled=${enabled.map((source) => source.institution).join(' | ')}; missing=${missing.join(' | ') || 'none'}; unexpected=${unexpected.map((source) => source.institution).join(' | ') || 'none'}`);
  }
  return poc;
}

export const KNOWN_ATS_HOST_HINTS = Object.freeze([
  'recruitee.com','teamtailor.com','personio.de','personio.com','greenhouse.io','lever.co',
  'homerun.co','afasinsite.nl','successfactors.com','smartrecruiters.com','workable.com',
]);

export const SOURCE_TERMS = /(?:vacatures?|vacancies|vacancy|jobs?|careers?|werken[\s-]*bij|join[\s-]*us|employment|opportunit(?:y|ies)|recruitment)/i;
// Discovery deliberately avoids generic institution-name words such as "museum" or "instituut".
// Those terms caused irrelevant reports/media links to be followed during the first POC run.
export const DISCOVERY_TERMS = /(?:about|over[\s-]*(?:ons|het)|organisatie|organization|organisation|team|people|contact|opportunit(?:y|ies)|werken[\s-]*bij|careers?)/i;
