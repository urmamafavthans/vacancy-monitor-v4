export function diagnosticRow({
  runTime,
  runId,
  institution,
  entryUrl,
  resolvedSourceUrl = '',
  candidateTitle = '',
  candidateUrl = '',
  route = '',
  extractionMethod = '',
  decision = '',
  reason = '',
  evidence = '',
}) {
  return [
    runTime,
    runId,
    institution,
    entryUrl,
    resolvedSourceUrl,
    candidateTitle,
    candidateUrl,
    route,
    extractionMethod,
    decision,
    reason,
    evidence,
  ];
}
