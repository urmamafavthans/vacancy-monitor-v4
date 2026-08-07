function short(value, max = 1500) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
export function diagnosticRow({ runTime, runId, institution, entryUrl, resolvedSourceUrl = '', candidateTitle = '', candidateUrl = '', route = '', extractionMethod = '', decision = '', reason = '', evidence = '' }) {
  return [runTime, runId, institution, entryUrl, resolvedSourceUrl, short(candidateTitle, 300), candidateUrl, route, extractionMethod, decision, short(reason, 500), short(evidence, 1500)];
}
