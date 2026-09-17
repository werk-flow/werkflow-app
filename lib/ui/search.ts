/**
 * German-locale search normalization. `toLocaleLowerCase('de-DE')` keeps umlaut
 * and ß case-folding correct where plain `toLowerCase` does not; every search
 * needle in the app should come from here.
 */
export function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('de-DE');
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
