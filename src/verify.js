const GENERIC_NAVIGATION_TITLES = new Set([
  'visit',
  'bezoek',
  'who we are',
  'wie we zijn',
  'what we do',
  'wat we doen',
  'the building',
  'het gebouw',
  'support us',
  'steun ons',
  'organization',
  'organisatie',
  'opening hours',
  'openingstijden',
  'partners',
  'team',
  'home',
  'shop',
  'winkel',
  'newsletter',
  'see also',
  'zie ook',
]);

const EXCLUDED_EMPLOYMENT = /\b(?:internship|intern|trainee|traineeship|stage|stagiair|stagiaire|volunteer position|volunteer role|vrijwilligersfunctie|onbezoldigd|unpaid role|open application|open sollicitatie)\b/i;
const EMPLOYMENT_EVIDENCE = /\b(?:apply|solliciteer|solliciteren|deadline|closing date|sluitingsdatum|salary|salaris|cao|fte|\d+(?:[.,]\d+)?\s*(?:-|–|tot|to)?\s*\d*(?:[.,]\d+)?\s*(?:uur|hours?|u\.?)(?:\s*(?:per|p\/?w|week))?|full[- ]?time|part[- ]?time|deeltijd|voltijd|freelance|zzp|employment contract|arbeidsovereenkomst)\b/i;

export function normalizeTitle(title) {
  return String(title ?? '').replace(/\s+/g, ' ').trim();
}

export function isGenericNavigationTitle(title) {
  return GENERIC_NAVIGATION_TITLES.has(normalizeTitle(title).toLowerCase());
}

export function hasEmploymentEvidence(text) {
  return EMPLOYMENT_EVIDENCE.test(String(text ?? ''));
}

export function isExplicitlyExcludedEmployment(text) {
  return EXCLUDED_EMPLOYMENT.test(String(text ?? ''));
}

export function verifyCandidate({ title, identityProof = false, employmentText = '' }) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return { verified: false, reason: 'missing title' };
  if (isGenericNavigationTitle(cleanTitle)) return { verified: false, reason: 'generic navigation title' };

  const combined = `${cleanTitle} ${employmentText}`;
  if (isExplicitlyExcludedEmployment(combined)) {
    return { verified: false, reason: 'excluded employment type' };
  }
  if (!identityProof) return { verified: false, reason: 'missing vacancy identity proof' };
  if (!hasEmploymentEvidence(combined)) return { verified: false, reason: 'missing employment evidence' };

  return { verified: true, reason: 'identity and employment evidence present' };
}
