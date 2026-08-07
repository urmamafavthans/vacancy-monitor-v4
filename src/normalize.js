import { createHash } from 'node:crypto';
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function fingerprint(source, title, url) { return createHash('sha256').update(`${source.institution}\n${title.toLowerCase()}\n${url}`).digest('hex').slice(0, 32); }
function firstMatch(text, regex) { const match = String(text ?? '').match(regex); return cleanText(match?.[0] || ''); }
function dateValue(value) { if (!value) return ''; const match = String(value).match(/\d{4}-\d{2}-\d{2}/); return match?.[0] || cleanText(value).slice(0, 40); }
function contractMode(text) {
  const value = String(text ?? '');
  if (/\b(?:freelance|zzp)\b/i.test(value)) return 'Freelance/ZZP';
  if (/\b(?:onbepaalde tijd|permanent|vast contract)\b/i.test(value)) return 'Permanent';
  if (/\b(?:bepaalde tijd|temporary|tijdelijk|jaarcontract|fixed[- ]term)\b/i.test(value)) return 'Fixed-term';
  if (/\b(?:arbeidsovereenkomst|employment contract|dienstverband)\b/i.test(value)) return 'Employment';
  return '';
}
export function normalizeVerifiedVacancy(candidate, source, verification, nowIso) {
  const structured = candidate.structured || {}; const evidenceText = cleanText(`${candidate.employmentText || ''} ${structured.description || ''}`);
  const hours = firstMatch(evidenceText, /\b\d+(?:[.,]\d+)?\s*(?:-|–|—|tot|to)?\s*\d*(?:[.,]\d+)?\s*(?:uur|hours?)(?:\s*(?:per|p\/?w|week))?\b/i);
  const closing = dateValue(structured.validThrough) || firstMatch(evidenceText, /\b\d{4}-\d{2}-\d{2}\b/); const posted = dateValue(structured.datePosted); const fp = fingerprint(source, candidate.title, candidate.url);
  return { fingerprint: fp, values: [nowIso, nowIso, source.institution, candidate.title, '', candidate.url, candidate.sourceUrl, source.city, posted, closing, hours, contractMode(evidenceText), '', source.travelTimeMinutes, 'VERIFIED', fp, `${candidate.method}; ${verification.evidence}`.slice(0, 1000)] };
}
