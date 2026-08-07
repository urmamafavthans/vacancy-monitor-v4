import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSourcePage } from '../src/discovery.js';
import { extractCandidates } from '../src/extract.js';
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

test('linked Kunsthal job uses the detail page title and ignores internship text from the source card container', () => {
  const sourceUrl = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/';
  const url = 'https://www.kunsthal.nl/nl/over-de-kunsthal/organisatie/werken-bij-de-kunsthal/vacature-manager-partnerships/';
  const detailHtml = '<html><head><title>Vacature Manager Partnerships - Kunsthal</title></head><body><main><h1>Vacature Manager Partnerships</h1><h3>Manager Partnerships (32 - 36 uur)</h3><p>Salaris volgens Museum-cao.</p><p>Een arbeidsovereenkomst voor de duur van één jaar.</p><p>Solliciteren kan tot uiterlijk 24 augustus 2026.</p></main></body></html>';
  const candidate = { title: 'Werken bij de Kunsthal', url, sourceUrl, method: 'DETAIL_LINK', employmentText: 'Werken bij de Kunsthal Stagiair marketing & communicatie meewerkstage', identityProof: true };
  const result = verifyJobPage(candidate, page(url, detailHtml));
  assert.equal(result.decision, 'VERIFIED');
  assert.equal(result.title, 'Manager Partnerships');
});
