/**
 * The printed number of each Position of Titel `sectionNumber`, `1.2`; a text
 * line carries none and the priced positions count on. The editor and the PDF
 * number by this one rule.
 */
export function positionNumbers(
  sectionNumber: string,
  positions: ReadonlyArray<{ kind: string }>,
): Array<string | null> {
  let counted = 0;
  return positions.map((position) => {
    if (position.kind === 'text') return null;
    counted += 1;
    return `${sectionNumber}.${counted}`;
  });
}
