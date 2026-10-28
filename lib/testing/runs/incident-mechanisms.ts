import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { getTestGroups } from '../selection/test-groups';

/**
 * A Tier 1 or Tier 2 prevention is a mechanism, so the incident log must name one that exists
 * (decision 0005). Until 2026-10-16 the check read only the tier's wording, and two entries called
 * a one-hook code repair "Tier 1" without any mechanism behind it. `bun run test:runs classify`
 * refuses such a prevention.
 */
export type MechanismIndex = {
  fileExists: (path: string) => boolean;
  /** Lint rule ids configured in eslint.config.mjs, for example `playwright-spec/no-raw-key-press`. */
  lintRules: ReadonlySet<string>;
  /** Restricted-syntax selector sets declared in eslint.config.mjs, for example `specSelectors`. */
  selectorSets: ReadonlySet<string>;
  /** Registered verification group ids, for example `sql:security`. */
  groupIds: ReadonlySet<string>;
};

/** A claim reads "Tier 1: ..." or "Tier 2, ..."; "Tier 1 and 2 cannot reach it" claims nothing. */
const TIER_ONE_OR_TWO = /\bTier [12]\s*[:,]/;
const PATH_TOKEN =
  /(?:\.githooks\/[\w.-]+|[\w.][\w.()[\]-]*\/(?:[\w.()[\]-]+\/)*[\w.()[\]-]+\.(?:ts|tsx|mjs|cjs|js|sql|json|ya?ml|sh|css)\b)/g;
const LINT_TOKEN = /@?[a-z][\w-]*\/[a-z][\w-]+/g;
const SELECTOR_TOKEN = /\b[a-z]\w*Selectors\b/g;
const GROUP_TOKEN = /\b(?:static|unit|sql|ui|audit|golden|canary):[\w:-]+\b/g;

/** The mechanisms a prevention names: every path it cites, and the paths, rules, selector sets and groups that resolve. */
export function namedMechanisms(
  prevention: string,
  index: MechanismIndex,
): { resolved: string[]; missingPaths: string[] } {
  const paths = [...new Set(prevention.match(PATH_TOKEN) ?? [])];
  const withoutPaths = paths.reduce((text, path) => text.replaceAll(path, ' '), prevention);
  const others = [
    ...(withoutPaths.match(LINT_TOKEN) ?? []).filter((token) => index.lintRules.has(token)),
    ...(withoutPaths.match(SELECTOR_TOKEN) ?? []).filter((token) => index.selectorSets.has(token)),
    ...(withoutPaths.match(GROUP_TOKEN) ?? []).filter((token) => index.groupIds.has(token)),
  ];
  return {
    resolved: [...paths.filter((path) => index.fileExists(path)), ...new Set(others)],
    missingPaths: paths.filter((path) => !index.fileExists(path)),
  };
}

/** Null when the prevention claims no Tier 1 or 2, or names at least one mechanism that exists and no path that does not. */
export function tierClaimProblem(prevention: string, index: MechanismIndex): string | null {
  if (!TIER_ONE_OR_TWO.test(prevention)) return null;
  const { resolved, missingPaths } = namedMechanisms(prevention, index);
  if (missingPaths.length)
    return `The prevention cites ${missingPaths.join(', ')}, which does not exist in the repository.`;
  if (resolved.length) return null;
  return 'A Tier 1 or Tier 2 prevention names its mechanism: a repository file (the guard, primitive or test), a lint rule id or selector set from eslint.config.mjs, or a group id. A code repair without one is "no prevention claim" or Tier 3 with its reason (decision 0005).';
}

/** The mechanisms of this repository: its files, the configured lint rules and selector sets, and the registered groups. */
export function repositoryMechanismIndex(repositoryRoot: string): MechanismIndex {
  const config = readFileSync(resolve(repositoryRoot, 'eslint.config.mjs'), 'utf8');
  return {
    // Only a file inside the repository is a mechanism of it.
    fileExists: (path) =>
      !isAbsolute(path) && !path.split('/').includes('..') && existsSync(resolve(repositoryRoot, path)),
    lintRules: new Set(
      [...config.matchAll(/'(@?[a-z][\w-]*\/[a-z][\w-]+)'/g)].map((match) => match[1] ?? ''),
    ),
    selectorSets: new Set(
      [...config.matchAll(/\bconst ([a-z]\w*Selectors)\b/g)].map((match) => match[1] ?? ''),
    ),
    groupIds: new Set(getTestGroups(repositoryRoot).map((group) => group.id)),
  };
}
