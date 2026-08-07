import { createHash } from 'node:crypto';
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function fingerprint(source, title, url) { return createHash('sha256').update(`${source.institution}\n${title.toLowerCase()}\n${url}`).digest('hex').slice(0, 32); }
function firstMatch(text, regex) { const match = String(text ?? '').match(regex); return cleanText(match?.[0] || ''); }
function dateValue(value) { if (!value) return ''; const match = String(value).match(/\d{4}-\d{2}-\d{2}/); return match?.[0] || cleanText(value).slice(0, 40); }
function contractMode(text) {
  const value = String(text ?? '');
  if (/\b(?:freelance|zzp)\b/i.test(value)) return 'Freelance/ZZP';
  if (/\b(?:onbepaalde tijd|permanent|vast contract)\b/i.test(value)) return 'Permanent';
  if (/\b(?:bepaalde tijd|temporary|tijdelijk|jaarcontract|projectaanstelling|fixed[- ]term)\b/i.test(value)) return 'Fixed-term';
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
export function normalizeVerifiedVacancy(candidate, source, verification, nowIso) {
  const structured = candidate.structured || {};
  const evidenceText = cleanText(`${verification.employmentText || ''} ${candidate.employmentText || ''} ${structured.description || ''}`);
  const hours = firstMatch(evidenceText, /\b\d+(?:[.,]\d+)?\s*(?:-|–|—|tot|to)?\s*\d*(?:[.,]\d+)?\s*(?:uur|hours?)(?:\s*(?:per|p\/?w|week))?\b/i);
  const closing = dateValue(structured.validThrough) || closingDate(evidenceText, nowIso); const posted = dateValue(structured.datePosted); const fp = fingerprint(source, candidate.title, candidate.url);
  return { fingerprint: fp, values: [nowIso, nowIso, source.institution, candidate.title, '', candidate.url, candidate.sourceUrl, source.city, posted, closing, hours, contractMode(evidenceText), '', source.travelTimeMinutes, 'VERIFIED', fp, `${candidate.method}; ${verification.evidence}`.slice(0, 1000)] };
}
