/**
 * Shared German-locale search normalization for every searchable list in the
 * app (SearchableSelect, document dialogs, pickers). `toLocaleLowerCase('de-DE')`
 * keeps umlaut and ß case-folding correct where plain `toLowerCase` does not.
 */

export function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('de-DE');
}

export function matchesQuery(text: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return text.toLocaleLowerCase('de-DE').includes(normalizedQuery);
}

export function filterByQuery<T>(
  items: T[],
  query: string,
  getText: (item: T) => string
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    getText(item).toLocaleLowerCase('de-DE').includes(normalizedQuery)
  );
}
