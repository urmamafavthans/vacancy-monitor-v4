import { createHash } from 'node:crypto';
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function canonicalUrl(value) {
  try {
    const url = new URL(value); url.hash = ''; url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch { return cleanText(value).replace(/[?#].*$/, '').replace(/\/$/, ''); }
}
function fingerprint(source, title, url, sourceUrl) {
  const detailUrl = canonicalUrl(url); const sourceCanonical = canonicalUrl(sourceUrl);
  const identity = detailUrl && detailUrl !== sourceCanonical ? `${source.institution}\n${detailUrl}` : `${source.institution}\n${sourceCanonical}\n${cleanText(title).toLowerCase()}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}
function firstMatch(text, regex) { const match = String(text ?? '').match(regex); return cleanText(match?.[0] || ''); }
function dateValue(value) { if (!value) return ''; const match = String(value).match(/\d{4}-\d{2}-\d{2}/); return match?.[0] || cleanText(value).slice(0, 40); }
function contractMode(text) {
  const value = String(text ?? '');
  if (/\b(?:freelance|zzp)\b/i.test(value)) return 'Freelance/ZZP';
  if (/\b(?:onbepaalde tijd|permanent|vast contract)\b/i.test(value)) return 'Permanent';
  if (/\b(?:bepaalde tijd|temporary|tijdelijk|jaarcontract|projectaanstelling|fixed[- ]term|duur van (?:een|één|1) jaar)\b/i.test(value)) return 'Fixed-term';
  if (/\b(?:arbeidsovereenkomst|employment contract|dienstverband|aanstelling)\b/i.test(value)) return 'Employment';
  return '';
}
const MONTHS = new Map(Object.entries({
  januari:1,january:1,februari:2,february:2,maart:3,march:3,april:4,mei:5,may:5,juni:6,june:6,juli:7,july:7,
  augustus:8,august:8,september:9,oktober:10,october:10,november:11,december:12,
}));
function isoDate(year, month, day) { return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
function closingDate(text, nowIso) {
  const value = cleanText(text);
  const numeric = value.match(/\b(?:deadline|uiterlijk|tot(?: en met)?|t\/m|before|until)?\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/i);
  if (numeric) return isoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const monthPattern = [...MONTHS.keys()].join('|');
  const named = value.match(new RegExp(`\\b(?:deadline|uiterlijk|tot(?: en met)?|t\\/m|reageren kan tot(?: en met)?|solliciteren kan(?: tot| t\\/m)?|before|until)?\\s*(?:\\w+\\s+)?(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`, 'i'));
  if (!named) return '';
  const month = MONTHS.get(named[2].toLowerCase());
  const year = Number(named[3] || String(nowIso || '').slice(0,4) || new Date().getUTCFullYear());
  return month ? isoDate(year, month, Number(named[1])) : '';
}
function weeklyHours(text) {
  const value = String(text ?? '');
  const options = firstMatch(value, /\b\d{1,2}(?:\s*,\s*\d{1,2})+\s*(?:of|or)\s*\d{1,2}\s*(?:uur|hours?)(?:\s*(?:per\s+week|week))?\b/i);
  if (options) return options;
  return firstMatch(value, /\b\d+(?:[.,]\d+)?\s*(?:-|–|—|tot|to)?\s*\d*(?:[.,]\d+)?\s*(?:uur|hours?)(?:\s*(?:per\s+week|p\/?w|week))?\b/i);
}
export function normalizeVerifiedVacancy(candidate, source, verification, nowIso) {
  const structured = candidate.structured || {};
  const title = cleanText(verification.title || candidate.title);
  const primaryEvidence = verification.employmentText || candidate.employmentText || '';
  const evidenceText = cleanText(`${primaryEvidence} ${structured.description || ''}`);
  const hours = weeklyHours(evidenceText);
  const closing = dateValue(structured.validThrough) || closingDate(evidenceText, nowIso); const posted = dateValue(structured.datePosted);
  const fp = fingerprint(source, title, candidate.url, candidate.sourceUrl);
  return { fingerprint: fp, values: [nowIso, nowIso, source.institution, title, '', canonicalUrl(candidate.url), canonicalUrl(candidate.sourceUrl), source.city, posted, closing, hours, contractMode(evidenceText), '', source.travelTimeMinutes, 'VERIFIED', fp, `${candidate.method}; ${verification.evidence}`.slice(0, 1000)] };
}
