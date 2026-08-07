import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasEmploymentEvidence,
  isGenericNavigationTitle,
  verifyCandidate,
} from '../src/verify.js';

test('rejects generic navigation titles seen in v3.4 false positives', () => {
  for (const title of ['Visit', 'Who we are', 'What we do', 'The building', 'Support us', 'Organization', 'Opening hours', 'Partners', 'Team']) {
    assert.equal(isGenericNavigationTitle(title), true, title);
  }
});

test('recognises plain Dutch and English hour evidence', () => {
  assert.equal(hasEmploymentEvidence('36 uur'), true);
  assert.equal(hasEmploymentEvidence('15 tot 36 uur per week'), true);
  assert.equal(hasEmploymentEvidence('24 hours per week'), true);
  assert.equal(hasEmploymentEvidence('0.8 FTE'), true);
});

test('requires both vacancy identity and employment evidence', () => {
  assert.deepEqual(
    verifyCandidate({ title: 'Manager Partnerships', identityProof: true, employmentText: '32–36 uur, solliciteer voor 24 augustus' }),
    { verified: true, reason: 'identity and employment evidence present' },
  );
  assert.equal(
    verifyCandidate({ title: 'Manager Partnerships', identityProof: false, employmentText: '32–36 uur' }).verified,
    false,
  );
  assert.equal(
    verifyCandidate({ title: 'Manager Partnerships', identityProof: true, employmentText: '' }).verified,
    false,
  );
});

test('rejects explicit internship, volunteer-only, unpaid and open-application records', () => {
  for (const text of ['Internship 32 hours', 'Stage 4 dagen', 'Vrijwilligersfunctie', 'Unpaid role', 'Open sollicitatie']) {
    assert.equal(
      verifyCandidate({ title: 'Candidate', identityProof: true, employmentText: text }).verified,
      false,
      text,
    );
  }
});

test('does not reject paid roles merely because the subject is volunteers', () => {
  const result = verifyCandidate({
    title: 'Vrijwilligerscoördinator',
    identityProof: true,
    employmentText: '24 uur per week, salaris volgens cao, solliciteer voor 12 augustus',
  });
  assert.equal(result.verified, true);
});
