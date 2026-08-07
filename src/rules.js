const GENERIC_NAVIGATION_TITLES = new Set([
  'visit','bezoek','bezoeken','visiting','who we are','wie we zijn','what we do','wat we doen','the building','het gebouw',
  'support us','steun ons','organization','organisation','organisatie','opening hours','openingstijden','partners',
  'team','home','shop','winkel','newsletter','see also','zie ook','programme','program','now showing',
  'the family of migrants','hku as a workplace','applying step by step','vacancy','vacancies','vacature','vacatures',
  'jobs','careers','werken bij','werken bij ons','join us',
]);

const EXCLUDED_EMPLOYMENT = /\b(?:internship|intern|trainee|traineeship|stage|stagiair|stagiaire|volunteer position|volunteer role|vrijwilligersfunctie|vrijwilligerswerk|onbezoldigd|unpaid role|unpaid position|open application|open sollicitatie)\b/i;
const VOLUNTEER_ONLY_TITLE = /^(?:volunteer|vrijwilliger|vrijwilligers?)$/i;
const EMPLOYMENT_EVIDENCE = /\b(?:apply|solliciteer|solliciteren|reageer|deadline|closing date|sluitingsdatum|salary|salaris|cao|fte|\d+(?:[.,]\d+)?\s*(?:-|–|—|tot|to)?\s*\d*(?:[.,]\d+)?\s*(?:uur|hours?|u\.?)(?:\s*(?:per|p\/?w|week))?|full[- ]?time|part[- ]?time|deeltijd|voltijd|freelance|zzp|employment contract|arbeidsovereenkomst|contractduur|contract type|dienstverband)\b/i;

function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
export function normalizeTitle(title) { return cleanText(title); }
export function isGenericNavigationTitle(title) { return GENERIC_NAVIGATION_TITLES.has(normalizeTitle(title).toLowerCase()); }
export function hasEmploymentEvidence(text) { return EMPLOYMENT_EVIDENCE.test(String(text ?? '')); }
export function isExplicitlyExcludedEmployment(text) { return EXCLUDED_EMPLOYMENT.test(String(text ?? '')); }
export function isVolunteerOnlyTitle(title) { return VOLUNTEER_ONLY_TITLE.test(normalizeTitle(title)); }

export function verifyCandidate({ title, identityProof = false, employmentText = '' }) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return { verified: false, reason: 'missing title' };
  if (isGenericNavigationTitle(cleanTitle)) return { verified: false, reason: 'generic navigation title' };
  if (isVolunteerOnlyTitle(cleanTitle)) return { verified: false, reason: 'volunteer-only title' };
  const combined = `${cleanTitle} ${employmentText}`;
  if (isExplicitlyExcludedEmployment(combined)) return { verified: false, reason: 'excluded employment type' };
  if (!identityProof) return { verified: false, reason: 'missing vacancy identity proof' };
  if (!hasEmploymentEvidence(combined)) return { verified: false, reason: 'missing employment evidence' };
  return { verified: true, reason: 'identity and employment evidence present' };
}
