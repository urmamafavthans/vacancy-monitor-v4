import * as cheerio from 'cheerio';
import { DISCOVERY_TERMS, KNOWN_ATS_HOST_HINTS, SOURCE_TERMS } from './config.js';

const GENERIC_BAD_SCHEMES = /^(?:mailto:|tel:|javascript:|data:)/i;
const SOURCE_PATH = /\/(?:vacatures?|vacancies|jobs?|careers?|werken[-_]?bij|work[-_]?with[-_]?us|join[-_]?us)\/?$/i;
const SOURCE_LABEL = /^(?:vacatures?|vacancies|vacancy|jobs?|careers?|werken bij(?: ons)?|work with us|join us)$/i;
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

export function normalizeHttpUrl(href, baseUrl) {
  try {
    if (!href || GENERIC_BAD_SCHEMES.test(href) || href.startsWith('#')) return null;
    const url = new URL(href, baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; }
}

export function isKnownAtsUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN_ATS_HOST_HINTS.some((hint) => host === hint || host.endsWith(`.${hint}`));
  } catch { return false; }
}
function isSourceLikePath(url) { try { return SOURCE_PATH.test(new URL(url).pathname); } catch { return false; } }
function pageHasJobPosting(html) { return /["']@type["']\s*:\s*["']JobPosting["']/i.test(html || ''); }

export function extractAnchors(html, baseUrl) {
  const $ = cheerio.load(html || '');
  const anchors = [];
  $('a[href]').each((_, element) => {
    const el = $(element);
    const url = normalizeHttpUrl(el.attr('href'), baseUrl);
    if (!url) return;
    const text = cleanText([el.text(), el.attr('aria-label'), el.attr('title')].filter(Boolean).join(' '));
    anchors.push({ url, text });
  });
  return anchors;
}

export function scoreVacancyLink({ url, text }, baseUrl) {
  let score = 0;
  const combined = `${text} ${url}`;
  if (isKnownAtsUrl(url)) score += 12;
  if (SOURCE_LABEL.test(cleanText(text))) score += 9;
  else if (/\b(?:vacatures|vacancies|careers|werken bij|join us|work with us)\b/i.test(text)) score += 6;
  if (isSourceLikePath(url)) score += 7;
  try { if (new URL(url).origin !== new URL(baseUrl).origin && !isKnownAtsUrl(url)) score -= 8; } catch {}
  if (/privacy|cookie|newsletter|shop|ticket|donate|support/i.test(combined)) score -= 10;
  return score;
}

export function scoreSourcePage(page) {
  if (!page?.html || page.error) return -100;
  const $ = cheerio.load(page.html);
  const title = cleanText($('title').first().text());
  const h1 = cleanText($('h1').first().text());
  const url = page.finalUrl || page.requestedUrl;
  let score = 0;
  if (isKnownAtsUrl(url)) score += 12;
  if (isSourceLikePath(url)) score += 7;
  if (SOURCE_TERMS.test(title) && !pageHasJobPosting(page.html)) score += 4;
  if (SOURCE_TERMS.test(h1) && !pageHasJobPosting(page.html)) score += 5;
  if (pageHasJobPosting(page.html) && !isSourceLikePath(url) && !isKnownAtsUrl(url)) score -= 6;
  const vacancyLinks = extractAnchors(page.html, url).filter((link) => scoreVacancyLink(link, url) >= 6);
  if (vacancyLinks.length >= 2) score += 3;
  else if (vacancyLinks.length === 1) score += 1;
  return score;
}

function sourceCandidateLinks(page) {
  const base = page.finalUrl || page.requestedUrl;
  return extractAnchors(page.html, base).map((link) => ({ ...link, score: scoreVacancyLink(link, base) })).filter((link) => link.score >= 6).sort((a, b) => b.score - a.score);
}
function exploratoryLinks(page, entryOrigin) {
  const base = page.finalUrl || page.requestedUrl;
  return extractAnchors(page.html, base)
    .filter((link) => { try { return new URL(link.url).origin === entryOrigin; } catch { return false; } })
    .map((link) => {
      const pathText = new URL(link.url).pathname.replace(/[-_]/g, ' ');
      let score = 0;
      if (DISCOVERY_TERMS.test(link.text)) score += 4;
      if (DISCOVERY_TERMS.test(pathText)) score += 3;
      if (SOURCE_LABEL.test(cleanText(link.text)) || isSourceLikePath(link.url)) score += 8;
      return { ...link, score };
    }).filter((link) => link.score >= 3).sort((a, b) => b.score - a.score);
}
async function bestLoadedSource(urls, loader) {
  const unique = [...new Set(urls)].slice(0, 10);
  const pages = await loader(unique);
  let best = null;
  for (const url of unique) {
    const page = pages.get(url);
    if (!page) continue;
    const score = scoreSourcePage(page);
    if (!best || score > best.score) best = { page, score };
  }
  return best;
}
async function sitemapCandidates(entryUrl, loader) {
  const origin = new URL(entryUrl).origin;
  const sitemapUrl = `${origin}/sitemap.xml`;
  const pages = await loader([sitemapUrl], { browserFallback: false });
  const page = pages.get(sitemapUrl);
  if (!page?.html || page.error) return [];
  const $ = cheerio.load(page.html, { xmlMode: true });
  const urls = [];
  $('loc').each((_, node) => { const url = cleanText($(node).text()); if (url && isSourceLikePath(url)) urls.push(url); });
  return [...new Set(urls)].slice(0, 20);
}

export async function resolveVacancySource(source, loader) {
  const trace = [];
  if (source.resolvedVacancyUrl) {
    const cached = await bestLoadedSource([source.resolvedVacancyUrl], loader);
    trace.push(`cached score=${cached?.score ?? 'unavailable'}`);
    if (cached && cached.score >= 6) return { resolvedUrl: cached.page.finalUrl, method: 'CACHED_SOURCE', page: cached.page, trace };
  }
  const entryPages = await loader([source.entryUrl]);
  const entry = entryPages.get(source.entryUrl);
  if (!entry || entry.error) return { resolvedUrl: null, method: 'ENTRY_ERROR', page: entry, trace: [`entry load failed: ${entry?.error || 'unknown'}`] };
  const entryScore = scoreSourcePage(entry);
  trace.push(`entry score=${entryScore}`);
  if (entryScore >= 6) return { resolvedUrl: entry.finalUrl, method: 'ENTRY_IS_SOURCE', page: entry, trace };
  const direct = sourceCandidateLinks(entry);
  trace.push(`direct vacancy links=${direct.length}`);
  if (direct.length) {
    const best = await bestLoadedSource(direct.map((item) => item.url), loader);
    if (best && best.score >= 6) return { resolvedUrl: best.page.finalUrl, method: isKnownAtsUrl(best.page.finalUrl) ? 'EXTERNAL_ATS' : 'VACANCY_LINK', page: best.page, trace: [...trace, `direct source score=${best.score}`] };
  }
  const sitemap = await sitemapCandidates(entry.finalUrl, loader);
  trace.push(`sitemap candidates=${sitemap.length}`);
  if (sitemap.length) {
    const best = await bestLoadedSource(sitemap, loader);
    if (best && best.score >= 6) return { resolvedUrl: best.page.finalUrl, method: 'SITEMAP', page: best.page, trace: [...trace, `sitemap source score=${best.score}`] };
  }
  const origin = new URL(entry.finalUrl).origin;
  let frontier = exploratoryLinks(entry, origin).slice(0, 12);
  const visited = new Set([entry.finalUrl]);
  for (let depth = 1; depth <= Math.max(1, Math.min(source.crawlDepth || 2, 3)); depth += 1) {
    const urls = frontier.map((item) => item.url).filter((url) => !visited.has(url)).slice(0, 12);
    urls.forEach((url) => visited.add(url));
    if (!urls.length) break;
    const pages = await loader(urls);
    const next = [];
    for (const url of urls) {
      const page = pages.get(url);
      if (!page || page.error) continue;
      const selfScore = scoreSourcePage(page);
      if (selfScore >= 6) return { resolvedUrl: page.finalUrl, method: `SAME_DOMAIN_DEPTH_${depth}`, page, trace: [...trace, `depth ${depth} source score=${selfScore}`] };
      const directLinks = sourceCandidateLinks(page);
      if (directLinks.length) {
        const best = await bestLoadedSource(directLinks.map((item) => item.url), loader);
        if (best && best.score >= 6) return { resolvedUrl: best.page.finalUrl, method: isKnownAtsUrl(best.page.finalUrl) ? 'EXTERNAL_ATS' : `DISCOVERED_DEPTH_${depth}`, page: best.page, trace: [...trace, `depth ${depth} linked source score=${best.score}`] };
      }
      next.push(...exploratoryLinks(page, origin));
    }
    frontier = next.sort((a, b) => b.score - a.score).slice(0, 12);
  }
  return { resolvedUrl: null, method: 'SOURCE_NOT_FOUND', page: entry, trace };
}
