// The user-flow catalog (docs/product/user-flow-catalog.md) gives every flow a stable id that
// the coverage map and the slice records cite: slice sections stand in id order, flow ids are
// unique and sequential within their slice, and an acceptance invariant counts the section's flows.

const SECTION_PATTERN = /^### `(P1-\d{2}a?)`[^\n]*\n([\s\S]*?)(?=^### |\n## |$(?![\s\S]))/gm;

/** Ordering, uniqueness, sequence and invariant-count problems of the catalog. */
export function findCatalogProblems(markdown: string): string[] {
  const problems: string[] = [];
  let previousKey = '';
  const seen = new Set<string>();
  for (const [, sliceId = '', body = ''] of markdown.matchAll(SECTION_PATTERN)) {
    const key = sliceId.padEnd(6, ' ');
    if (key < previousKey) problems.push(`section ${sliceId} is out of id order`);
    previousKey = key;
    const flowIds = [...body.matchAll(new RegExp(`^- \`(${sliceId}-F\\d{2,3})\``, 'gm'))].flatMap(
      (entry) => entry[1] ?? [],
    );
    flowIds.forEach((flowId, index) => {
      if (seen.has(flowId)) problems.push(`flow id ${flowId} is defined twice`);
      seen.add(flowId);
      const expected = `${sliceId}-F${String(index + 1).padStart(2, '0')}`;
      if (flowId !== expected)
        problems.push(`${sliceId} flow ids are not sequential; expected ${expected}, found ${flowId}`);
    });
    const invariant = body.match(/\*\*Acceptance invariant:\*\* `(\d+)\/(\d+) mapped/);
    if (invariant && Number(invariant[1]) !== flowIds.length)
      problems.push(
        `${sliceId} invariant says ${invariant[1]} flows but the section defines ${flowIds.length}`,
      );
  }
  return problems;
}
