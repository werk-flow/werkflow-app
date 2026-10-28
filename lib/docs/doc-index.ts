// The docs index (docs/README.md) is exhaustive: every doc under docs/ has a row, except the
// index itself. A row that states a status agrees with the doc it links.

import type { DocStatus } from './status-lines';

/** Docs (paths under docs/) the index does not link. */
export function findIndexCoverageProblems(indexMarkdown: string, docPaths: readonly string[]): string[] {
  return docPaths
    .filter((path) => path !== 'README.md')
    .filter((path) => !indexMarkdown.includes(`(${path})`) && !indexMarkdown.includes(`(${path}#`))
    .map((path) => `${path} is not linked from docs/README.md; add it to the index or retire the file`);
}

const STATUS_ROW = /^\| \[[^\]]+\]\(([^)]+)\)\s*\| (Closed|Living|Complete|Accepted) — /gm;

/** Index rows whose "Closed —" or "Living —" prefix disagrees with the target's status line. */
export function findIndexStatusProblems(
  indexMarkdown: string,
  statuses: ReadonlyMap<string, DocStatus | null>,
): string[] {
  const problems: string[] = [];
  for (const [, target = '', prefix = ''] of indexMarkdown.matchAll(STATUS_ROW)) {
    if (prefix === 'Complete' || prefix === 'Accepted') {
      problems.push(`the row for ${target} uses "${prefix} —"; index rows say "Closed —" or "Living —" only`);
      continue;
    }
    const status = statuses.get(target);
    if (status && status.kind !== prefix.toLowerCase())
      problems.push(`the row for ${target} says "${prefix}" but the doc's status line says "${status.kind}"`);
  }
  return problems;
}
