/**
 * Phase 7 implementation point.
 * ENTRY route responsibility: resolve a careers/vacancy source.
 * It must never emit a verified vacancy directly.
 */
export async function resolveVacancySource(source) {
  if (source.resolvedVacancyUrl) {
    return {
      resolvedUrl: source.resolvedVacancyUrl,
      method: 'cached-resolved-source',
    };
  }
  return {
    resolvedUrl: null,
    method: 'not-implemented-preflight',
  };
}
