// The app's own UI strings: the only texts a redrawn screenshot keeps.
// The build extracts them from the source (extract-ui-strings.ts) and inlines
// them into the redraw's lazy chunk; docs/technical/problem-report-scrubbing.md
// owns the rule.

/** The normalized UI strings. A text stays readable only when the whole text is one of them. */
export type UiStringCatalog = ReadonlySet<string>;

/** Collapses every whitespace run to one space and trims, as HTML renders it. */
export function normalizeUiText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * True when `text` belongs in the catalog: it has a letter. A text of digits
 * and punctuation alone is never UI vocabulary, and it is the shape of a phone
 * number, a date or an amount.
 */
export function isCatalogCandidate(normalized: string): boolean {
  return /\p{L}/u.test(normalized);
}

/** True when the whole text, normalized, is one of the app's own UI strings. */
export function isUiString(catalog: UiStringCatalog, text: string): boolean {
  const normalized = normalizeUiText(text);
  return isCatalogCandidate(normalized) && catalog.has(normalized);
}
