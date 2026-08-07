import * as cheerio from 'cheerio';
import { isKnownAtsUrl } from './discovery.js';
import { hasEmploymentEvidence, isExcludedTitle, isExplicitlyExcludedEmployment, isGenericNavigationTitle, isVolunteerOnlyTitle, normalizeTitle, verifyCandidate } from './rules.js';
export { hasEmploymentEvidence, isExplicitlyExcludedEmployment, isGenericNavigationTitle, normalizeTitle, verifyCandidate };

const APPLY_TEXT = /\b(?:apply|solliciteer|solliciteren|reageer|application|aanmelden)\b/i;
const DETAIL_PATH = /(?:\/vacature-[^/?#]+|\/(?:vacatures?|vacancies|vacancy|jobs?|careers?)\/[^/?#]{2,}|\/jobs?\/\d+)/i;
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function pageHasJobPosting(html) { return /["']@type["']\s*:\s*["']JobPosting["']/i.test(html || ''); }
function normalizedWords(value) { return new Set(cleanText(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)); }
function titleMatches(candidateTitle, pageTitle) {
  const a = normalizedWords(candidateTitle); const b = normalizedWords(pageTitle); if (!a.size || !b.size) return false;
  let overlap = 0; for (const word of a) if (b.has(word)) overlap += 1; return overlap >= Math.min(2, a.size);
}
function hasDedicatedApplication($) {
  let found = false;
  $('a[href], button, form[action]').each((_, node) => { const text = cleanText($(node).text()); const href = String($(node).attr('href') || $(node).attr('action') || ''); if (APPLY_TEXT.test(`${text} ${href}`)) found = true; });
  return found;
}
function isDedicatedDetailUrl(url, sourceUrl) {
  try { const u = new URL(url); const source = new URL(sourceUrl); if (u.toString() === source.toString()) return false; if (DETAIL_PATH.test(u.pathname)) return true; return isKnownAtsUrl(url) && (u.hostname !== source.hostname || u.pathname !== source.pathname); } catch { return false; }
}
function focusedJobText($) {
  $('style,script,noscript,svg,nav,footer,header').remove();
  const root = $('main').first().length ? $('main').first() : ($('article').first().length ? $('article').first() : $('body'));
  return cleanText(root.text()).slice(0, 50000);
}
export function verifyJobPage(candidate, page) {
  const title = normalizeTitle(candidate.title);
  if (!title) return { decision: 'REJECTED', reason: 'missing title', evidence: '', employmentText: '' };
  if (isGenericNavigationTitle(title)) return { decision: 'REJECTED', reason: 'generic navigation title', evidence: title, employmentText: '' };
  if (isVolunteerOnlyTitle(title)) return { decision: 'REJECTED', reason: 'volunteer-only title', evidence: title, employmentText: '' };
  if (isExcludedTitle(title)) return { decision: 'REJECTED', reason: 'excluded employment type', evidence: title, employmentText: candidate.employmentText || '' };
  if (!page || page.error || !page.html) return { decision: 'ERROR', reason: 'job page could not be loaded', evidence: page?.error || '', employmentText: '' };
  const $ = cheerio.load(page.html);
  const h1 = cleanText($('h1').first().text()); const documentTitle = cleanText($('title').first().text());
  const mainText = focusedJobText($);
  const relevant = cleanText(candidate.inlineSectionText || `${candidate.employmentText || ''} ${mainText}`);
  if (isExplicitlyExcludedEmployment(relevant)) return { decision: 'REJECTED', reason: 'excluded employment type', evidence: relevant.slice(0, 500), employmentText: relevant };
  const finalUrl = page.finalUrl || candidate.url; const identitySignals = [];
  if (pageHasJobPosting(page.html)) identitySignals.push('JobPosting');
  if (isDedicatedDetailUrl(finalUrl, candidate.sourceUrl)) identitySignals.push('dedicated job URL');
  if (candidate.method === 'INLINE_SECTION' && candidate.identityProof) identitySignals.push('isolated inline vacancy section');
  if (hasDedicatedApplication($)) identitySignals.push('application CTA/form');
  if (titleMatches(title, h1) || titleMatches(title, documentTitle)) identitySignals.push('title match');
  if (isKnownAtsUrl(finalUrl) && titleMatches(title, `${h1} ${documentTitle}`)) identitySignals.push('ATS job page');
  const gateA = identitySignals.includes('JobPosting') || identitySignals.includes('ATS job page') || (identitySignals.includes('dedicated job URL') && identitySignals.includes('title match')) || (identitySignals.includes('application CTA/form') && identitySignals.includes('title match')) || identitySignals.includes('isolated inline vacancy section');
  if (!gateA) return { decision: 'REJECTED', reason: 'missing independent vacancy identity proof', evidence: identitySignals.join(', ') || 'no identity signals', employmentText: relevant };
  if (!hasEmploymentEvidence(relevant)) return { decision: 'AMBIGUOUS', reason: 'vacancy identity present but employment evidence missing', evidence: identitySignals.join(', '), employmentText: relevant };
  return { decision: 'VERIFIED', reason: 'identity and employment evidence present', evidence: identitySignals.join(', '), employmentText: relevant };
}
