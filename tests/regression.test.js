import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRunContext, selectRunSources } from '../src/config.js';
import { hasEmploymentEvidence, isGenericNavigationTitle, verifyCandidate } from '../src/rules.js';

const FALSE_POSITIVE_TITLES = ['Visit','Who we are','What we do','The building','Support us','Organization','Opening hours','Partners','Programme','Team','Shop','Newsletter','Zie ook','Bezoeken','Steun ons','Wie we zijn','Wat we doen','Het gebouw','The Family of Migrants','Now showing','HKU as a workplace','Applying step by step','Vacatures','Vacancies','Jobs','Careers'];
test('rejects known v3.4 navigation and content false positives', () => { for (const title of FALSE_POSITIVE_TITLES) assert.equal(isGenericNavigationTitle(title), true, title); });
test('recognises plain Dutch and English employment evidence', () => { assert.equal(hasEmploymentEvidence('36 uur'), true); assert.equal(hasEmploymentEvidence('15 tot 36 uur per week'), true); assert.equal(hasEmploymentEvidence('24 hours per week'), true); assert.equal(hasEmploymentEvidence('0.8 FTE'), true); assert.equal(hasEmploymentEvidence('Solliciteer voor 24 augustus'), true); assert.equal(hasEmploymentEvidence('salaris volgens CAO'), true); });
test('requires both vacancy identity and employment evidence', () => { assert.deepEqual(verifyCandidate({ title: 'Manager Partnerships', identityProof: true, employmentText: '32–36 uur, solliciteer voor 24 augustus' }), { verified: true, reason: 'identity and employment evidence present' }); assert.equal(verifyCandidate({ title: 'Manager Partnerships', identityProof: false, employmentText: '32–36 uur' }).verified, false); assert.equal(verifyCandidate({ title: 'Manager Partnerships', identityProof: true, employmentText: '' }).verified, false); });
test('rejects internship, trainee, volunteer-only, unpaid and open applications', () => { for (const text of ['Internship 32 hours','Stage 4 dagen','Vrijwilligersfunctie','Unpaid role','Open sollicitatie']) assert.equal(verifyCandidate({ title: 'Candidate', identityProof: true, employmentText: text }).verified, false, text); assert.equal(verifyCandidate({ title: 'Vrijwilliger', identityProof: true, employmentText: '8 uur per week' }).verified, false); });
test('allows paid volunteer-coordination roles when employment evidence exists', () => { assert.equal(verifyCandidate({ title: 'Vrijwilligerscoördinator', identityProof: true, employmentText: '24 uur per week, salaris volgens cao, solliciteer voor 12 augustus' }).verified, true); });
test('allows unusual paid cultural-sector titles when the evidence gates pass', () => { for (const title of ['Archivaris','Digital Process Owner','Lid Raad van Toezicht','Interieurbouwer/Timmerman','AV-coördinator','Depotbeheerder']) assert.equal(verifyCandidate({ title, identityProof: true, employmentText: '24 uur per week, solliciteer voor 20 augustus' }).verified, true, title); });

const POC_SOURCES = [
  { enabled: true, institution: 'Kunstinstituut Melly' },
  { enabled: true, institution: 'Kunsthal Rotterdam' },
  { enabled: true, institution: 'Nieuwe Instituut | Huis Sonneveld' },
];
const EXPANSION_SOURCES = [
  ...POC_SOURCES,
  { enabled: true, institution: 'Roodkapje' },
  { enabled: true, institution: 'LUX Nijmegen' },
  { enabled: true, institution: 'HKU' },
];

test('POC safety gate still rejects additional enabled sources by default', () => {
  const context = scanRunContext({ POC_ONLY: 'true' });
  assert.throws(() => selectRunSources(EXPANSION_SOURCES, context), /POC safety gate failed/);
});

test('accepted expansion can run the POC subset without weakening the default safety gate', () => {
  const context = scanRunContext({ POC_ONLY: 'true', ALLOW_ADDITIONAL_ENABLED: 'true' });
  assert.deepEqual(selectRunSources(EXPANSION_SOURCES, context).map((source) => source.institution), POC_SOURCES.map((source) => source.institution));
  assert.equal(context.label, 'POC');
  assert.equal(context.statePrefix, 'POC');
});

test('expansion mode scans every enabled source and writes expansion state labels', () => {
  const context = scanRunContext({});
  assert.equal(selectRunSources(EXPANSION_SOURCES, context).length, 6);
  assert.equal(context.label, 'Expansion');
  assert.equal(context.statePrefix, 'EXPANSION');
});
