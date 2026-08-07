import * as cheerio from 'cheerio';
import { hasEmploymentEvidence, isGenericNavigationTitle, normalizeTitle } from './rules.js';
import { isKnownAtsUrl, normalizeHttpUrl } from './discovery.js';

const GENERIC_LINK_TEXT = /^(?:read more|learn more|more|view|view vacancy|bekijk vacature|lees meer|solliciteer|apply|details?)$/i;
const DETAIL_PATH = /(?:\/vacature-[^/?#]+|\/(?:vacatures?|vacancies|vacancy|jobs?|careers?)\/[^/?#]{2,}|\/jobs?\/\d+)/i;
const APPLY_TEXT = /\b(?:apply|solliciteer|solliciteren|reageer|application|aanmelden)\b/i;
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function stripHtml(value) { return cleanText(cheerio.load(String(value ?? '')).text()); }
function findJobPostings(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) { for (const item of value) findJobPostings(item, out); return out; }
  if (typeof value !== 'object') return out;
  const type = value['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(value);
  for (const child of Object.values(value)) findJobPostings(child, out);
  return out;
}
export function extractJobPostings(html) {
  const $ = cheerio.load(html || ''); const jobs = [];
  $('script[type="application/ld+json"]').each((_, node) => { const raw = $(node).contents().text(); if (!raw.trim()) return; try { findJobPostings(JSON.parse(raw), jobs); } catch {} });
  return jobs;
}
function structuredEmploymentText(job) {
  const parts = [job.employmentType, job.datePosted, job.validThrough, stripHtml(job.description)];
  if (job.baseSalary) parts.push(JSON.stringify(job.baseSalary));
  if (job.jobLocation) parts.push(JSON.stringify(job.jobLocation));
  return cleanText(parts.filter(Boolean).join(' '));
}
function compileOptionalPattern(pattern) { if (!pattern) return null; try { return new RegExp(pattern, 'i'); } catch { return null; } }
function headingFromContainer($, element) {
  const container = $(element).closest('article, li, section, [class*="job"], [class*="vacan"], [class*="career"], [class*="position"], [class*="role"], [data-job]');
  return { container, heading: cleanText(container.find('h1,h2,h3,h4,h5,h6').first().text()) };
}
function looksLikeDetailUrl(url, sourceUrl, explicitPattern) {
  if (explicitPattern?.test(new URL(url).pathname)) return true;
  if (DETAIL_PATH.test(new URL(url).pathname)) return true;
  if (isKnownAtsUrl(url)) { try { const u = new URL(url); const source = new URL(sourceUrl); return u.pathname !== '/' && (u.hostname !== source.hostname || u.pathname !== source.pathname); } catch { return false; } }
  return false;
}
function candidateTitleFromAnchor($, element) {
  const anchor = $(element); let title = cleanText(anchor.text()); const { container, heading } = headingFromContainer($, element);
  if (!title || GENERIC_LINK_TEXT.test(title)) title = heading;
  return { title: normalizeTitle(title), container };
}
function extractLinkedCandidates(html, pageUrl, source) {
  const $ = cheerio.load(html || ''); const pattern = compileOptionalPattern(source.jobUrlPattern); const candidates = [];
  $('a[href]').each((_, element) => {
    const url = normalizeHttpUrl($(element).attr('href'), pageUrl);
    if (!url || url === pageUrl || !looksLikeDetailUrl(url, pageUrl, pattern)) return;
    const { title, container } = candidateTitleFromAnchor($, element);
    if (!title || isGenericNavigationTitle(title)) return;
    candidates.push({ title, url, sourceUrl: pageUrl, method: pattern?.test(new URL(url).pathname) ? 'JOB_URL_PATTERN' : (isKnownAtsUrl(url) ? 'ATS_LINK' : 'DETAIL_LINK'), identityProof: true, employmentText: cleanText(container.text()), structured: null });
  });
  return candidates;
}
function extractInlineCandidates(html, pageUrl) {
  const $ = cheerio.load(html || ''); const candidates = [];
  $('article, [data-job], [class*="job-card"], [class*="job_item"], [class*="job-item"], [class*="vacan"], section[id*="vacan"], section[class*="vacan"], section[id*="job"], section[class*="job"]').each((_, node) => {
    const section = $(node); const text = cleanText(section.text());
    if (text.length < 30 || text.length > 8000 || !hasEmploymentEvidence(text) || !APPLY_TEXT.test(text)) return;
    const title = normalizeTitle(cleanText(section.find('h1,h2,h3,h4,h5,h6').first().text()));
    if (!title || isGenericNavigationTitle(title)) return;
    candidates.push({ title, url: pageUrl, sourceUrl: pageUrl, method: 'INLINE_SECTION', identityProof: true, employmentText: text, inlineSectionText: text, structured: null });
  });
  return candidates;
}
export function extractCandidates(page, source) {
  if (!page?.html || page.error) return [];
  const pageUrl = page.finalUrl || page.requestedUrl; const candidates = [];
  for (const job of extractJobPostings(page.html)) {
    const title = normalizeTitle(job.title || job.name); if (!title || isGenericNavigationTitle(title)) continue;
    const url = normalizeHttpUrl(job.url, pageUrl) || pageUrl;
    candidates.push({ title, url, sourceUrl: pageUrl, method: 'JSON_LD_JOBPOSTING', identityProof: true, employmentText: structuredEmploymentText(job), structured: job });
  }
  candidates.push(...extractLinkedCandidates(page.html, pageUrl, source));
  candidates.push(...extractInlineCandidates(page.html, pageUrl));
  const seen = new Set();
  return candidates.filter((candidate) => { const key = `${candidate.url}\n${candidate.title.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 25);
}
