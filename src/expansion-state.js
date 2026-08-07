import { createHash } from 'node:crypto';

export const EXPANSION_STATES = Object.freeze({
  PENDING: 'PENDING',
  TESTING: 'TESTING',
  VALIDATED: 'VALIDATED',
  BLOCKED: 'BLOCKED',
});

export function normalizedExpansionState(source) {
  const state = String(source?.expansionState || '').trim().toUpperCase();
  return Object.values(EXPANSION_STATES).includes(state) ? state : EXPANSION_STATES.PENDING;
}

export function selectActiveBatch(sources, batchSize) {
  const active = sources.filter((source) => normalizedExpansionState(source) === EXPANSION_STATES.TESTING);
  if (active.length > batchSize) throw new Error(`Expansion safety gate failed: ${active.length} TESTING sources exceed batch size ${batchSize}.`);
  return active;
}

export function selectNextBatch(sources, batchSize) {
  return sources.filter((source) => normalizedExpansionState(source) === EXPANSION_STATES.PENDING).slice(0, batchSize);
}

export function resultSignature(parts) {
  const stable = [...parts].map((part) => String(part)).sort().join('\n');
  return createHash('sha256').update(stable).digest('hex').slice(0, 20);
}

export function transitionExpansionSource(source, result, { requiredCleanRuns = 2, maxAttempts = 4 } = {}) {
  const attempts = Number(source.attempts || 0) + 1;
  if (result.clean) {
    const cleanStreak = source.resultSignature === result.signature ? Number(source.cleanStreak || 0) + 1 : 1;
    const validated = cleanStreak >= requiredCleanRuns;
    return {
      enabled: true,
      expansionState: validated ? EXPANSION_STATES.VALIDATED : EXPANSION_STATES.TESTING,
      cleanStreak,
      attempts,
      resultSignature: result.signature,
      blockerReason: '',
    };
  }

  const blocked = attempts >= maxAttempts;
  return {
    enabled: !blocked,
    expansionState: blocked ? EXPANSION_STATES.BLOCKED : EXPANSION_STATES.TESTING,
    cleanStreak: 0,
    attempts,
    resultSignature: result.signature,
    blockerReason: blocked ? result.reason : '',
  };
}

export function expansionCounts(sources) {
  const counts = { pending: 0, testing: 0, validated: 0, blocked: 0 };
  for (const source of sources) counts[normalizedExpansionState(source).toLowerCase()] += 1;
  return counts;
}
