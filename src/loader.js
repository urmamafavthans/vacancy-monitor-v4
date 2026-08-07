import * as cheerio from 'cheerio';
import { CheerioCrawler, PlaywrightCrawler, log } from 'crawlee';
import { randomUUID } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

log.setLevel(log.LEVELS.WARNING);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pageUsesClientFramework(html) {
  if (!html) return false;
  const $ = cheerio.load(html);
  const appRoot = $('[id="__next"], [id="app"], [id="root"], [data-reactroot]').length > 0;
  const frameworkScripts = $('script#__NEXT_DATA__, script[src*="/_next/"], script[src*="webpack"], script[src*="react"]').length > 0;
  return appRoot && (frameworkScripts || $('script').length >= 6);
}

function pageLooksClientRendered(html) {
  if (!html) return true;
  const $ = cheerio.load(html);
  const text = cleanText($('body').text());
  if (text.length < 180) return true;
  const appShell = $('[id="__next"], [id="app"], [id="root"], [data-reactroot]').length > 0;
  return appShell && text.length < 700 && $('script').length >= 4;
}

export function needsBrowserValidation(html) {
  return pageLooksClientRendered(html) || pageUsesClientFramework(html);
}

function requestFor(url, mode) {
  return { url, uniqueKey: `${mode}:${url}:${randomUUID()}` };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pageFromPdfText(url, text) {
  const clean = cleanText(text);
  const firstLine = String(text ?? '').split(/\r?\n/).map(cleanText).find(Boolean) || '';
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    contentType: 'application/pdf',
    html: `<html><head><title>${escapeHtml(firstLine)}</title></head><body><main>${escapeHtml(clean)}</main></body></html>`,
    text: clean,
    method: 'PDF_TEXT',
    error: null,
  };
}

async function loadPdfPages(urls) {
  const results = new Map();
  await Promise.all(urls.map(async (url) => {
    const parser = new PDFParse({ url });
    try {
      const parsed = await parser.getText();
      results.set(url, pageFromPdfText(url, parsed.text));
    } catch (error) {
      results.set(url, { requestedUrl: url, finalUrl: url, statusCode: null, contentType: 'application/pdf', html: '', text: '', method: 'PDF_TEXT', error: error?.message || 'PDF request failed' });
    } finally {
      await parser.destroy().catch(() => {});
    }
  }));
  return results;
}

async function loadWithCheerio(urls) {
  const results = new Map();
  const crawler = new CheerioCrawler({
    maxConcurrency: 3,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 25,
    additionalMimeTypes: ['application/xml', 'text/xml', 'application/xhtml+xml'],
    async requestHandler({ request, $, response }) {
      const html = $.html();
      results.set(request.url, {
        requestedUrl: request.url,
        finalUrl: request.loadedUrl || request.url,
        statusCode: response?.statusCode ?? null,
        contentType: String(response?.headers?.['content-type'] ?? ''),
        html,
        text: cleanText($('body').text()),
        method: 'CHEERIO',
        error: null,
      });
    },
    async failedRequestHandler({ request }, error) {
      results.set(request.url, { requestedUrl: request.url, finalUrl: request.loadedUrl || request.url, statusCode: null, contentType: '', html: '', text: '', method: 'CHEERIO', error: error?.message || 'Cheerio request failed' });
    },
  });
  await crawler.run(urls.map((url) => requestFor(url, 'cheerio')));
  return results;
}

async function loadWithBrowser(urls) {
  const results = new Map();
  if (!urls.length) return results;
  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 40,
    navigationTimeoutSecs: 30,
    launchContext: { launchOptions: { headless: true } },
    async requestHandler({ request, page, response }) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      const html = await page.content();
      const text = cleanText(await page.locator('body').innerText().catch(() => ''));
      let headers = {};
      if (response) headers = await response.allHeaders().catch(() => ({}));
      results.set(request.url, {
        requestedUrl: request.url,
        finalUrl: page.url() || request.loadedUrl || request.url,
        statusCode: response?.status() ?? null,
        contentType: String(headers['content-type'] ?? ''),
        html,
        text,
        method: 'PLAYWRIGHT',
        error: null,
      });
    },
    async failedRequestHandler({ request }, error) {
      results.set(request.url, { requestedUrl: request.url, finalUrl: request.loadedUrl || request.url, statusCode: null, contentType: '', html: '', text: '', method: 'PLAYWRIGHT', error: error?.message || 'Browser request failed' });
    },
  });
  await crawler.run(urls.map((url) => requestFor(url, 'browser')));
  return results;
}

export async function loadPages(urls, { browserFallback = true } = {}) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return new Map();
  const pdfUrls = unique.filter((url) => /\.pdf(?:$|[?#])/i.test(url));
  const htmlUrls = unique.filter((url) => !pdfUrls.includes(url));
  const [primary, pdfPages] = await Promise.all([loadWithCheerio(htmlUrls), loadPdfPages(pdfUrls)]);
  for (const [url, page] of pdfPages) primary.set(url, page);
  if (!browserFallback) return primary;
  const fallbackUrls = htmlUrls.filter((url) => {
    const page = primary.get(url);
    return !page || page.error || page.statusCode >= 400 || needsBrowserValidation(page.html);
  });
  if (!fallbackUrls.length) return primary;
  const browser = await loadWithBrowser(fallbackUrls);
  for (const url of fallbackUrls) {
    const result = browser.get(url);
    if (result && !result.error) primary.set(url, result);
  }
  return primary;
}

export async function loadPage(url, options) {
  const pages = await loadPages([url], options);
  return pages.get(url) ?? null;
}
