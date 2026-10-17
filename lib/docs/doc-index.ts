// The docs index (docs/README.md) is exhaustive: every doc under docs/ has a row, except the
// index itself and the slice records, which the folder row and the roadmap cover. A row that
// states a status agrees with the doc it links.

import type { DocStatus } from './status-lines';

const SLICE_FOLDER = 'plans/phase-1/slices/';

/** Docs (paths under docs/) the index does not link, and a slice record whose folder row is missing. */
export function findIndexCoverageProblems(indexMarkdown: string, docPaths: readonly string[]): string[] {
  const problems: string[] = [];
  const sliceFolderCovered = indexMarkdown.includes('phase-1/slices');
  for (const path of docPaths) {
    if (path === 'README.md') continue;
    if (path.startsWith(SLICE_FOLDER)) {
      if (!sliceFolderCovered)
        problems.push(
          `${path} relies on the phase-1/slices folder row, which is missing from docs/README.md`,
        );
      continue;
    }
    if (!indexMarkdown.includes(`(${path})`) && !indexMarkdown.includes(`(${path}#`))
      problems.push(`${path} is not linked from docs/README.md; add it to the index or retire the file`);
  }
  return problems;
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
