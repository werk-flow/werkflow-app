// Rules for guidance and budgets (decision 0004): guidance outside docs/ may only point at
// documents that exist, and a budgeted file is measured in words.

/** Whitespace-separated words, the same count `wc -w` prints. */
export function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((word) => word.length > 0).length;
}

export type DocumentReference = { kind: 'link' | 'path'; target: string };

/**
 * The references a guidance file outside docs/ makes to other files: relative
 * markdown links (resolved from the file's folder) and backticked `docs/...md`
 * paths (resolved from the repository root). External links and bare anchors
 * are not file references.
 */
export function findDocumentReferences(markdown: string): DocumentReference[] {
  const references: DocumentReference[] = [];
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (target === undefined || /^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (path) references.push({ kind: 'link', target: path });
  }
  for (const match of markdown.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)) {
    if (match[1] !== undefined) references.push({ kind: 'path', target: match[1] });
  }
  return references;
}
