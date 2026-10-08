// Mechanical rules for living documents (decision 0004, amendment 2026-10-01):
// a living technical doc states rules as they are now, stays inside a word
// budget, and guidance outside docs/ may only point at documents that exist.

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const LINK_TARGET_PATTERN = /\]\([^)\s]+\)/g;
const STATUS_LINE_NUMBER = 3;

/** 1-based numbers of the lines that carry a `YYYY-MM-DD` date outside the status line and outside link targets. */
export function findDatedLines(markdown: string): number[] {
  const dated: number[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (lineNumber === STATUS_LINE_NUMBER) return;
    // A link target may name a dated heading of a decision record; the prose around it may not.
    if (DATE_PATTERN.test(line.replace(LINK_TARGET_PATTERN, ']()'))) dated.push(lineNumber);
  });
  return dated;
}

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

// German quotation marks open low („) and close high (“). A straight or English closing quote after „
// renders as a mismatched pair. lib/conventions/german-copy.test.ts holds the same rule for product copy.
// Written with escapes so that this line is not itself a mismatched pair.
const MISMATCHED_GERMAN_QUOTE = /\u201E[^\u201C\u201D"\u201E\n]*["\u201D]/;

/** 1-based numbers of the lines where a quotation that opens with „ closes with `"` or `”` instead of `“`. */
export function findMismatchedGermanQuotes(markdown: string): number[] {
  return markdown
    .split(/\r?\n/)
    .flatMap((line, index) => (MISMATCHED_GERMAN_QUOTE.test(line) ? [index + 1] : []));
}
