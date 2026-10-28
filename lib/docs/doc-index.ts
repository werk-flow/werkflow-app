// The docs index (docs/README.md) is exhaustive: every doc under docs/ has a row, except the
// index itself.

/** Docs (paths under docs/) the index does not link. */
export function findIndexCoverageProblems(indexMarkdown: string, docPaths: readonly string[]): string[] {
  return docPaths
    .filter((path) => path !== 'README.md')
    .filter((path) => !indexMarkdown.includes(`(${path})`) && !indexMarkdown.includes(`(${path}#`))
    .map((path) => `${path} is not linked from docs/README.md; add it to the index or retire the file`);
}
