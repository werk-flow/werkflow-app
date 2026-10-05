/** Pure naming rules of the document library: copy names and the next free sibling name. */

function splitFileName(fileName: string): {
  baseName: string;
  extension: string;
} {
  const trimmed = fileName.trim();
  const lastDotIndex = trimmed.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return { baseName: trimmed || 'Dokument', extension: '' };
  }

  return {
    baseName: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex),
  };
}

export function getCopyDisplayName(fileName: string): string {
  return `Kopie von ${fileName.trim() || 'Dokument'}`;
}

/**
 * The preferred name, or the first `name (n)` that no sibling uses, compared
 * case-insensitively. A file name keeps its extension after the counter.
 */
export function firstAvailableName({
  preferredName,
  takenNames,
  keepExtension,
}: {
  preferredName: string;
  takenNames: ReadonlySet<string>;
  keepExtension: boolean;
}): string {
  const taken = new Set([...takenNames].map((name) => name.toLowerCase()));
  if (!taken.has(preferredName.toLowerCase())) return preferredName;

  const { baseName, extension } = keepExtension
    ? splitFileName(preferredName)
    : { baseName: preferredName, extension: '' };
  let counter = 1;
  let candidate = `${baseName} (${counter})${extension}`;
  while (taken.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${baseName} (${counter})${extension}`;
  }
  return candidate;
}
