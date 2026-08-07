import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVacancySource, scoreSourcePage } from '../src/discovery.js';
import { extractCandidates } from '../src/extract.js';
import { needsBrowserValidation, pageFromPdfText } from '../src/loader.js';
import { normalizeVerifiedVacancy } from '../src/normalize.js';
import { verifyJobPage } from '../src/verify.js';

function page(url, html) { return { requestedUrl: url, finalUrl: url, html, text: String(html).replace(/<[^>]+>/g, ' '), error: null, method: 'CHEERIO' }; }

test('Melly About page with an exact Vacancies section is accepted as a source even with zero jobs', () => {
  const url = 'https://www.kunstinstituutmelly.nl/en/about';
  const html = '<html><head><title>About</title></head><body><main><h1>About</h1><h3>Vacancies</h3><p>At the moment, there are no vacancies.</p><a href="/files/report.pdf">Annual report</a></main></body></html>';
  assert.ok(scoreSourcePage(page(url, html)) >= 6);
});

test('Kunsthal working-at path is accepted as a vacancy source', () => {
  const url = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/';
  const html = '<html><head><title>Werken bij de Kunsthal - Kunsthal</title></head><body><h1>Werken bij de Kunsthal</h1><p>Op dit moment heeft de Kunsthal de volgende vacatures.</p></body></html>';
  assert.ok(scoreSourcePage(page(url, html)) >= 6);
});

test('paid job is not rejected because a footer mentions internships', () => {
  const sourceUrl = 'https://nieuweinstituut.nl/projects/over-ons/vacatures';
  const url = 'https://nieuweinstituut.nl/pages/vacature-av-coordinator';
  const html = '<html><head><title>Vacature AV-coördinator</title></head><body><main><h1>Vacature AV-coördinator</h1><p>Nieuwe Instituut zoekt een AV-coördinator (18 uur)</p><p>Salaris volgens Museum CAO.</p><h4>Reageren</h4><p>Solliciteer uiterlijk 9 augustus 2026.</p></main><footer>Stageplaatsen en open sollicitaties</footer></body></html>';
  const result = verifyJobPage({ title: 'AV-coördinator', url, sourceUrl, method: 'JOB_URL_PATTERN', employmentText: '', identityProof: true }, page(url, html));
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'AV-coördinator');
});

test('internship title remains excluded', () => {
  const sourceUrl = 'https://nieuweinstituut.nl/projects/over-ons/vacatures';
  const url = 'https://nieuweinstituut.nl/pages/vacature-stagiair-development';
  const html = '<html><head><title>Vacature Stagiair Development</title></head><body><main><h1>Stagiair Development</h1><p>32 uur per week. Solliciteer nu.</p></main></body></html>';
  const result = verifyJobPage({ title: 'Stagiair Development', url, sourceUrl, method: 'JOB_URL_PATTERN', employmentText: '', identityProof: true }, page(url, html));
  assert.equal(result.decision, 'REJECTED');
  assert.equal(result.reason, 'excluded employment type');
});

test('Kunsthal CTA links inherit vacancy headings, including a non-vacature detail URL', () => {
  const url = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/';
  const html = '<html><body><main><h2>Werken bij de Kunsthal</h2><h3>Manager Partnerships</h3><p>(32 - 36 uur)</p><p><a href="/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/vacature-manager-partnerships/">Lees hier de hele vacature.</a></p><h3>Medewerker beveiliging</h3><p>(18, 24 of 36 uur)</p><p><a href="/nl/medewerker-beveiliging/">Lees hier de volledige vacature en solliciteer!</a></p><h3>Coördinator Hospitality & Events</h3><p>(36 uur)</p><p><a href="/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/vacature-coordinator-hospitality-events-2026/">Lees hier de hele vacature.</a></p><h3>Medewerker Productie Tentoonstellingen</h3><p>(32-36 uur)</p><p><a href="/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/vacature-medewerker-productie-tentoonstellingen/">Lees hier de hele vacature!</a></p><h3>Stagiair marketing & communicatie</h3><p>(32 - 36 uur)</p><p><a href="/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/stage-marketing-en-communicatie/">Bekijk hier de volledige vacature en solliciteer!</a></p></main></body></html>';
  const candidates = extractCandidates(page(url, html), { jobUrlPattern: '' });
  assert.deepEqual(candidates.map((candidate) => candidate.title), ['Manager Partnerships', 'Medewerker beveiliging', 'Coördinator Hospitality & Events', 'Medewerker Productie Tentoonstellingen', 'Stagiair marketing & communicatie']);
});

test('Kunsthal detail page ignores site-brand h1 and uses vacancy heading', () => {
  const sourceUrl = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/';
  const url = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/vacature-manager-partnerships/?edit&language=nl';
  const detailHtml = '<html><head><title>Vacature Manager Partnerships - Kunsthal</title></head><body><header><h1>Kunsthal Rotterdam</h1></header><main><h2>Vacature Manager Partnerships</h2><h3>Manager Partnerships (32 - 36 uur)</h3><p>Salaris volgens Museum-cao.</p><p>Een arbeidsovereenkomst voor de duur van één jaar.</p><p>Solliciteren kan tot uiterlijk 24 augustus 2026.</p></main></body></html>';
  const candidate = { title: 'Manager Partnerships', url, sourceUrl, method: 'DETAIL_LINK', employmentText: 'Stagiair marketing & communicatie 18, 24 of 36 uur', identityProof: true };
  const result = verifyJobPage(candidate, page(url, detailHtml));
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'Manager Partnerships');
});

test('embedded style text inside a Nieuwe Instituut heading cannot contaminate the canonical title', () => {
  const sourceUrl = 'https://nieuweinstituut.nl/projects/over-ons/vacatures';
  const url = 'https://nieuweinstituut.nl/pages/vacature-av-coordinator';
  const detailHtml = '<html><head><title>AV-coördinator | Nieuwe Instituut</title></head><body><main><h1><style>.css-a039nd{font-size:40px}</style>Vacature AV-coördinator</h1><p>18 uur per week. Salaris volgens Museum CAO.</p><p>Solliciteer uiterlijk 9 augustus 2026.</p></main></body></html>';
  const candidate = { title: 'AV-coördinator', url, sourceUrl, method: 'JOB_URL_PATTERN', employmentText: '', identityProof: true };
  const result = verifyJobPage(candidate, page(url, detailHtml));
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'AV-coördinator');
  assert.equal(result.title.includes('.css-'), false);
});

test('duplicated Nieuwe Instituut vacancy heading collapses to one canonical title', () => {
  const sourceUrl = 'https://nieuweinstituut.nl/projects/over-ons/vacatures';
  const url = 'https://nieuweinstituut.nl/pages/vacature-dataspecialist';
  const detailHtml = '<html><head><title>Vacature Dataspecialist</title></head><body><main><h1>Vacature DataspecialistVacature Dataspecialist</h1><p>Nieuwe Instituut zoekt een Dataspecialist (32-36 uur).</p><p>Salaris volgens Museum cao. Solliciteer doorlopend.</p></main></body></html>';
  const result = verifyJobPage({ title: 'Dataspecialist', url, sourceUrl, method: 'JOB_URL_PATTERN', employmentText: '', identityProof: true }, page(url, detailHtml));
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'Dataspecialist');
});

test('React or Next app roots require browser validation even when server HTML contains substantial text', () => {
  const substantial = 'Nieuwe Instituut vacaturetekst '.repeat(80);
  const html = `<html><body><div id="__next">${substantial}</div><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;
  assert.equal(needsBrowserValidation(html), true);
  const staticHtml = `<html><body><main>${substantial}</main></body></html>`;
  assert.equal(needsBrowserValidation(staticHtml), false);
});

test('normalization uses detail-page employment evidence instead of neighbouring source-card evidence', () => {
  const source = { institution: 'Kunsthal Rotterdam', city: 'Rotterdam', travelTimeMinutes: '80' };
  const candidate = { title: 'Manager Partnerships', url: 'https://www.kunsthal.nl/jobs/manager?language=nl', sourceUrl: 'https://www.kunsthal.nl/jobs/', method: 'DETAIL_LINK', employmentText: 'Neighbouring role: 18, 24 of 36 uur', structured: null };
  const verification = { title: 'Manager Partnerships', employmentText: 'Manager Partnerships 32 - 36 uur per week. Arbeidsovereenkomst voor één jaar. Solliciteer uiterlijk 24 augustus 2026.', evidence: 'dedicated job URL, title match' };
  const normalized = normalizeVerifiedVacancy(candidate, source, verification, '2026-08-07T15:00:00.000Z');
  assert.equal(normalized.values[10], '32 - 36 uur per week');
  assert.equal(normalized.values[9], '2026-08-24');
});

test('detail-page fingerprint is stable across title corrections and query-string variants', () => {
  const source = { institution: 'Example Institution', city: 'Rotterdam', travelTimeMinutes: '80' };
  const base = { sourceUrl: 'https://example.org/vacatures', method: 'DETAIL_LINK', employmentText: '', structured: null };
  const first = normalizeVerifiedVacancy({ ...base, title: 'Wrong title', url: 'https://example.org/vacature/123?language=nl' }, source, { title: 'Correct title', employmentText: '32 uur per week', evidence: '' }, '2026-08-07T15:00:00.000Z');
  const second = normalizeVerifiedVacancy({ ...base, title: 'Another title', url: 'https://example.org/vacature/123?utm_source=test' }, source, { title: 'Renamed role', employmentText: '32 uur per week', evidence: '' }, '2026-08-07T16:00:00.000Z');
  assert.equal(first.fingerprint, second.fingerprint);
});

test('institution-qualified vacancy headings identify a source page', () => {
  const url = 'https://example.org/info/join/';
  const html = '<html><head><title>Join</title></head><body><main><h1>Volunteers</h1><h2>Example Institution vacancies</h2><a href="/2026/08/07/vacature-programme-producer/">Vacature Programme Producer (0.6 FTE)</a></main></body></html>';
  assert.ok(scoreSourcePage(page(url, html)) >= 6);
});

test('descriptive vacancy links keep their role titles and vacancy-submission links are ignored', () => {
  const url = 'https://example.org/werkenbij/';
  const html = '<html><body><main><h1>Werken bij</h1><h2>Vacatures</h2><a href="/samenwerken/meld-vacature-aan">Meld een vacature aan</a><a href="/werkenbij/lid-raad-van-toezicht">Vacature: Lid raad van toezicht</a></main></body></html>';
  const candidates = extractCandidates(page(url, html), { jobUrlPattern: '\\/werkenbij\\/' });
  assert.deepEqual(candidates.map((candidate) => candidate.title), ['Vacature: Lid raad van toezicht']);
});

test('vacancy PDF links retain their role title and use document verification', () => {
  const sourceUrl = 'https://example.org/vacatures/';
  const pdfUrl = 'https://cdn.example.org/VacatureSpoelkeukenmedewerker.pdf';
  const sourceHtml = `<html><body><main><h1>Vacatures</h1><ul><li><a href="${pdfUrl}">Vacature Spoelkeukenmedewerker</a> (uren in overleg)</li></ul></main></body></html>`;
  const [candidate] = extractCandidates(page(sourceUrl, sourceHtml), { jobUrlPattern: '' });
  assert.equal(candidate.title, 'Vacature Spoelkeukenmedewerker');
  assert.equal(candidate.method, 'VACANCY_DOCUMENT_LINK');
  const documentPage = pageFromPdfText(pdfUrl, 'SPOELKEUKENMEDEWERKER\nWij zoeken iemand voor een aantal uur per week. Salariëring conform CAO Horeca. Stuur je sollicitatie naar sollicitatie@example.org.');
  const result = verifyJobPage(candidate, documentPage);
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'Spoelkeukenmedewerker');
  const normalized = normalizeVerifiedVacancy(candidate, { institution: 'Example', city: 'Nijmegen', travelTimeMinutes: '75' }, result, '2026-08-07T12:00:00.000Z');
  assert.equal(normalized.values[9], '');
  assert.equal(normalized.values[10], 'uren in overleg');
});

test('spaced PDF hour digits are repaired before normalization', () => {
  const pdfUrl = 'https://cdn.example.org/VacatureKok.pdf';
  const documentPage = pageFromPdfText(pdfUrl, 'ZELFSTANDIG WERKEND KOK\nMINIMAAL 2 4 UUR EN START 1 AUGUSTUS\nSalaris conform CAO. Solliciteer per e-mail.');
  const candidate = { title: 'Vacature Zelfstandig werkend kok', url: pdfUrl, sourceUrl: 'https://example.org/vacatures/', method: 'VACANCY_DOCUMENT_LINK', employmentText: '', identityProof: true, structured: null };
  const result = verifyJobPage(candidate, documentPage);
  const normalized = normalizeVerifiedVacancy(candidate, { institution: 'Example', city: 'Nijmegen', travelTimeMinutes: '75' }, result, '2026-08-07T12:00:00.000Z');
  assert.equal(normalized.values[9], '');
  assert.equal(normalized.values[10], '24 UUR');
});

test('explicit job URL patterns count as dedicated detail-page identity proof', () => {
  const sourceUrl = 'https://example.org/werkenbij/';
  const detailUrl = 'https://example.org/werkenbij/lid-raad-van-toezicht';
  const html = '<html><head><title>Vacature: Lid raad van toezicht</title></head><body><main><h1>Vacature: Lid raad van toezicht</h1><p>Bezoldiging volgens de geldende cao. Reageer uiterlijk 6 september 2026.</p></main></body></html>';
  const result = verifyJobPage({ title: 'Vacature: Lid raad van toezicht', url: detailUrl, sourceUrl, method: 'JOB_URL_PATTERN', employmentText: '', identityProof: true }, page(detailUrl, html));
  assert.equal(result.decision, 'VERIFIED');
});

test('a low-information server page is browser-validated before source resolution fails', async () => {
  const url = 'https://example.org/info/join/';
  const server = page(url, '<html><body><main><h1>Join</h1><p>Community information only.</p></main></body></html>');
  const rendered = { ...page(url, '<html><body><main><h1>Join</h1><h2>Example vacancies</h2><a href="/vacature-producer">Vacature Producer</a></main></body></html>'), method: 'PLAYWRIGHT' };
  const loader = async (urls, options = {}) => new Map(urls.map((item) => [item, options.forceBrowser ? rendered : server]));
  const resolution = await resolveVacancySource({ entryUrl: url, resolvedVacancyUrl: '', crawlDepth: 2 }, loader);
  assert.equal(resolution.method, 'ENTRY_BROWSER_VALIDATED');
});

test('configured job-pattern links prove that a low-scoring entry is a vacancy source', async () => {
  const url = 'https://example.org/info/join/';
  const entry = page(url, '<html><body><main><h1>Join</h1><a href="/2026/08/07/vacature-programme-producer/">Vacature Programme Producer</a></main></body></html>');
  const loader = async (urls) => new Map(urls.map((item) => [item, entry]));
  const resolution = await resolveVacancySource({ entryUrl: url, resolvedVacancyUrl: '', crawlDepth: 2, jobUrlPattern: '\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/vacature-[^?#]+$' }, loader);
  assert.equal(resolution.method, 'ENTRY_JOB_PATTERN');
});
