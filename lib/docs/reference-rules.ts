// References in living guidance that name something by a value that can go stale:
// a route handler by its folder, a rule by a number that no doc defines, and a
// repository path in a skill. Closed records are history and exempt.

export type LineReference = { line: number; name: string };

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

// `app/api/<name>` with an optional file or subfolder, and `/api/<name>` with an optional HTTP
// method, inside backticks. A placeholder or a wildcard names no single handler.
const ROUTE_HANDLER_PATTERN =
  /`(?:(?:GET|POST|PUT|PATCH|DELETE) )?(?:app\/api|\/api)\/([a-z0-9][a-z0-9-]*)(?:[/?][^`]*)?`/g;

/** The route handler names, the folder under `app/api/`, that a text names in backticks. */
export function findRouteHandlerReferences(text: string): LineReference[] {
  return [...text.matchAll(ROUTE_HANDLER_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [{ line: lineOf(text, match.index), name: match[1] }],
  );
}

// Only the docs index numbers its rules ("maintenance rule 3"). The testing guide, the virtue
// owner docs and the protocol name rules by heading, so "testing rule 12" resolves to nothing.
const NUMBERED_RULE_PATTERN =
  /\b(?:testing|security|quality|code-quality|review|design|ui|performance|realtime|protocol|docs) rules? \d+/gi;

/** Every "<area> rule N" phrase: a numbered rule that no doc defines. */
export function findNumberedRuleReferences(text: string): LineReference[] {
  return [...text.matchAll(NUMBERED_RULE_PATTERN)].map((match) => ({
    line: lineOf(text, match.index),
    name: match[0],
  }));
}

const REPOSITORY_ROOTS = [
  'app',
  'components',
  'hooks',
  'lib',
  'scripts',
  'tests',
  'supabase',
  'eslint-rules',
  'public',
  'types',
];
const REPOSITORY_PATH_PATTERN = new RegExp(`\`((?:${REPOSITORY_ROOTS.join('|')})/[^\`\\s]*)\``, 'g');

/**
 * Backticked repository paths in a skill, trimmed to what must exist: a `:line` suffix is
 * dropped, a glob or placeholder keeps its folder before the first `*` or `<`, and a trailing
 * slash is dropped. The caller resolves module specifiers without an extension.
 */
export function findRepositoryPathReferences(text: string): LineReference[] {
  const references: LineReference[] = [];
  for (const match of text.matchAll(REPOSITORY_PATH_PATTERN)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const wildcard = raw.search(/[*<{]/);
    const trimmed = (wildcard === -1 ? raw : raw.slice(0, raw.lastIndexOf('/', wildcard)))
      .replace(/:\d+(-\d+)?$/, '')
      .replace(/\/+$/, '');
    if (trimmed.includes('/') || REPOSITORY_ROOTS.includes(trimmed))
      references.push({ line: lineOf(text, match.index), name: trimmed });
  }
  return references;
}

/** The candidates a module specifier or path may resolve to, in order. */
export function repositoryPathCandidates(path: string): string[] {
  return ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'].map((suffix) => `${path}${suffix}`);
}
