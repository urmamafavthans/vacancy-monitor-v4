export function explicitlyZeroVacancies(page) {
  const text = String(page?.text || '').replace(/\s+/g, ' ').trim();
  return /(?:there (?:are|is) (?:currently |at the moment )?no vacancies|at the moment,? there are no vacancies|currently,?\s+(?:we have\s+)?no\s+(?:open\s+)?(?:positions?|vacancies?|job openings?)|no current vacancies|momenteel geen vacatures|op dit moment (?:zijn er )?geen vacatures|er zijn momenteel geen vacatures)/i.test(text);
}
