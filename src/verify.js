import * as cheerio from 'cheerio';
import { isKnownAtsUrl } from './discovery.js';
import { hasEmploymentEvidence, isExcludedTitle, isExplicitlyExcludedEmployment, isGenericNavigationTitle, isVolunteerOnlyTitle, normalizeTitle, verifyCandidate } from './rules.js';
export { hasEmploymentEvidence, isExplicitlyExcludedEmployment, isGenericNavigationTitle, normalizeTitle, verifyCandidate };

const APPLY_TEXT = /\b(?:apply|solliciteer|solliciteren|reageer|application|aanmelden)\b/i;
const DETAIL_PATH = /(?:\/vacature-[^/?#]+|\/(?:vacatures?|vacancies|vacancy|jobs?|careers?)\/[^/?#]{2,}|\/jobs?\/\d+)/i;
const JOB_PREFIX = /^(?:vacature|vacancy|job)\s*[:\-–—]?\s*/i;
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function sameUrl(a, b) { try { const x = new URL(a); const y = new URL(b); x.hash = ''; y.hash = ''; return x.toString().replace(/\/$/, '') === y.toString().replace(/\/$/, ''); } catch { return a === b; } }
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
  try { const u = new URL(url); const source = new URL(sourceUrl); if (sameUrl(u.toString(), source.toString())) return false; if (DETAIL_PATH.test(u.pathname)) return true; return isKnownAtsUrl(url) && (u.hostname !== source.hostname || u.pathname !== source.pathname); } catch { return false; }
}
function visibleNodeText($, node) {
  if (!node?.length) return '';
  const clone = node.clone(); clone.find('style,script,noscript,svg').remove();
  return cleanText(clone.text());
}
function cleanDetailTitle(value) {
  return normalizeTitle(cleanText(value).replace(JOB_PREFIX, '').replace(/\s*\(\s*\d[^)]*(?:uur|hours?)[^)]*\)\s*$/i, ''));
}
function cleanHeadings($) {
  const values = [];
  $('h1,h2,h3,h4').each((_, node) => {
    const text = visibleNodeText($, $(node));
    if (text && !values.includes(text)) values.push(text);
  });
  return values;
}
function cleanDocumentTitle($) {
  const title = visibleNodeText($, $('title').first());
  return cleanText(title);
}
function resolvedTitle(candidate, headings, documentTitle, finalUrl) {
  const original = cleanDetailTitle(candidate.title);
  const detailPage = !sameUrl(finalUrl, candidate.sourceUrl);
  if (!detailPage) return original;

  const prefixed = headings.find((heading) => JOB_PREFIX.test(heading));
  if (prefixed) {
    const title = cleanDetailTitle(prefixed);
    if (title && !isGenericNavigationTitle(title)) return title;
  }

  if (original && !isGenericNavigationTitle(original)) {
    const pageText = [...headings, documentTitle].join(' ');
    if (titleMatches(original, pageText)) return original;
  }

  const documentFirst = cleanDetailTitle(String(documentTitle || '').split(/\s+[|–—-]\s+/)[0]);
  if (documentFirst && !isGenericNavigationTitle(documentFirst)) return documentFirst;

  for (const heading of headings) {
    const title = cleanDetailTitle(heading);
    if (title && !isGenericNavigationTitle(title)) return title;
  }
  return original;
}
function focusedJobText($) {
  $('style,script,noscript,svg,nav,footer,header').remove();
  const root = $('main').first().length ? $('main').first() : ($('article').first().length ? $('article').first() : $('body'));
  return cleanText(root.text()).slice(0, 50000);
}
export function verifyJobPage(candidate, page) {
  const originalTitle = cleanDetailTitle(candidate.title);
  if (!originalTitle) return { decision: 'REJECTED', reason: 'missing title', evidence: '', employmentText: '', title: '' };
  if (!page || page.error || !page.html) return { decision: 'ERROR', reason: 'job page could not be loaded', evidence: page?.error || '', employmentText: '', title: originalTitle };
  const $ = cheerio.load(page.html);
  const headings = cleanHeadings($); const documentTitle = cleanDocumentTitle($);
  const finalUrl = page.finalUrl || candidate.url;
  const title = resolvedTitle(candidate, headings, documentTitle, finalUrl);
  if (!title) return { decision: 'REJECTED', reason: 'missing title', evidence: '', employmentText: '', title: '' };
  if (isGenericNavigationTitle(title)) return { decision: 'REJECTED', reason: 'generic navigation title', evidence: title, employmentText: '', title };
  if (isVolunteerOnlyTitle(title)) return { decision: 'REJECTED', reason: 'volunteer-only title', evidence: title, employmentText: '', title };
  if (isExcludedTitle(title)) return { decision: 'REJECTED', reason: 'excluded employment type', evidence: title, employmentText: candidate.employmentText || '', title };

  const mainText = focusedJobText($);
  const detailPage = !sameUrl(finalUrl, candidate.sourceUrl);
  const relevant = detailPage ? cleanText(mainText) : cleanText(candidate.inlineSectionText || candidate.employmentText || mainText);
  if (isExplicitlyExcludedEmployment(relevant)) return { decision: 'REJECTED', reason: 'excluded employment type', evidence: relevant.slice(0, 500), employmentText: relevant, title };

  const identitySignals = [];
  const headingText = headings.join(' ');
  if (pageHasJobPosting(page.html)) identitySignals.push('JobPosting');
  if (isDedicatedDetailUrl(finalUrl, candidate.sourceUrl)) identitySignals.push('dedicated job URL');
  if (candidate.method === 'INLINE_SECTION' && candidate.identityProof) identitySignals.push('isolated inline vacancy section');
  if (hasDedicatedApplication($)) identitySignals.push('application CTA/form');
  if (titleMatches(title, headingText) || titleMatches(title, documentTitle)) identitySignals.push('title match');
  if (isKnownAtsUrl(finalUrl) && titleMatches(title, `${headingText} ${documentTitle}`)) identitySignals.push('ATS job page');
  const gateA = identitySignals.includes('JobPosting') || identitySignals.includes('ATS job page') || (identitySignals.includes('dedicated job URL') && identitySignals.includes('title match')) || (identitySignals.includes('application CTA/form') && identitySignals.includes('title match')) || identitySignals.includes('isolated inline vacancy section');
  if (!gateA) return { decision: 'REJECTED', reason: 'missing independent vacancy identity proof', evidence: identitySignals.join(', ') || 'no identity signals', employmentText: relevant, title };
  if (!hasEmploymentEvidence(relevant)) return { decision: 'AMBIGUOUS', reason: 'vacancy identity present but employment evidence missing', evidence: identitySignals.join(', '), employmentText: relevant, title };
  return { decision: 'VERIFIED', reason: 'identity and employment evidence present', evidence: identitySignals.join(', '), employmentText: relevant, title };
}
