import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSourcePage } from '../src/discovery.js';
import { extractCandidates } from '../src/extract.js';
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
