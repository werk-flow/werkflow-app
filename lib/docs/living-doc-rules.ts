// Mechanical rules for living documents (decision 0004): a living doc states rules as they are
// now, a doc-to-doc reference is a link the checker can resolve, and guidance outside docs/ may
// only point at documents that exist.

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const LINK_TARGET_PATTERN = /\]\([^)\s]+\)/g;
const STATUS_LINE_NUMBER = 3;

/**
 * 1-based numbers of the lines that carry a `YYYY-MM-DD` date outside the status line and
 * outside link targets. Lines that `allowedLines` matches may carry one.
 */
export function findDatedLines(markdown: string, allowedLines?: RegExp): number[] {
  const dated: number[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    // `search` ignores lastIndex, so a global or sticky pattern answers the same for every line.
    if (lineNumber === STATUS_LINE_NUMBER || (allowedLines !== undefined && line.search(allowedLines) !== -1))
      return;
    // A link target may name a dated heading of a decision record; the prose around it may not.
    if (DATE_PATTERN.test(line.replace(LINK_TARGET_PATTERN, ']()'))) dated.push(lineNumber);
  });
  return dated;
}

// A commit hash: 7 to 40 hex characters with a digit and a letter, in backticks or after "commit".
const COMMIT_HASH = /(?:`|\bcommits?\s+)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i;

/** 1-based numbers of the lines that name a commit hash; Git, not a living doc, holds history. */
export function findCommitHashLines(markdown: string): number[] {
  return markdown
    .split(/\r?\n/)
    .flatMap((line, index) =>
      COMMIT_HASH.test(line.replace(LINK_TARGET_PATTERN, ']()')) ? [index + 1] : [],
    );
}

// Any backticked Markdown path, with or without a docs/ or ../ prefix.
const BACKTICKED_DOC_PATH = /`((?:docs\/|\.\.\/)?[A-Za-z0-9_-][A-Za-z0-9_./-]*\.md)`/g;

/**
 * Backticked references to documents inside docs/ that a relative link should carry, outside
 * fenced code, quotations and link text. `namesDoc` decides whether a backticked name is a doc
 * (artifact names and code-facing files such as `SKILL.md` are not).
 */
export function findBacktickedDocPaths(
  markdown: string,
  namesDoc: (reference: string) => boolean,
): { line: number; reference: string }[] {
  const found: { line: number; reference: string }[] = [];
  // The opening fence's character; a fence closes only with the same character.
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = null;
      return;
    }
    if (fence !== null || line.trimStart().startsWith('>')) return;
    // Link text may carry a backticked file name: [`x.md`](x.md).
    const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, '');
    for (const match of withoutLinks.matchAll(BACKTICKED_DOC_PATH)) {
      const reference = match[1];
      if (reference !== undefined && namesDoc(reference)) found.push({ line: index + 1, reference });
    }
  });
  return found;
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
