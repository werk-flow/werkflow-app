// Doc citations outside docs/: a code comment, a lint message or a thrown
// string that names `docs/<path>.md` (optionally with `#anchor`) must point at
// a document and heading that exist, or a reader follows a dead pointer.

export type DocCitation = { line: number; path: string; anchor: string | null };

// A docs path starts at a boundary: a leading `../` chain is allowed, a longer
// folder name ending in "docs" is not. The name before `.md` must be a real file name.
// An anchor takes the characters a heading slug keeps (`heading-anchors.ts`), umlauts included.
const CITATION_PATTERN =
  /(?<![A-Za-z0-9_./-])(?:\.\.\/)*(docs\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.md)(?:#([\p{L}\p{N}_-]+))?/gu;

/** Every `docs/...md` citation in a file's text, with its 1-based line. */
export function findDocCitations(text: string): DocCitation[] {
  const citations: DocCitation[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const path = match[1];
    if (path === undefined) continue;
    citations.push({
      line: text.slice(0, match.index).split('\n').length,
      path,
      anchor: match[2] ?? null,
    });
  }
  return citations;
}

/** Files whose citations are not checked: immutable history and research bookkeeping. */
export function isCitationCheckedFile(file: string): boolean {
  return (
    /\.(ts|tsx|mjs|sql|toml|md)$/.test(file) &&
    !file.startsWith('docs/') &&
    !file.startsWith('supabase/migrations/') &&
    !file.startsWith('temporary-transcripts/')
  );
}
