import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { groupSelections } from './group-selection';
import type { ChangeTrigger } from './change-triggers';
import { isPerformanceSpec } from './test-groups';

/** A group as the CI plan sees it: its id, kind, spec files and what its execution imports. */
export type CiGroup = {
  id: string;
  kind: string;
  files: readonly string[];
  scopes: readonly string[];
  executionInputs: readonly string[];
  /** The group's `changeTrigger`. */
  trigger?: ChangeTrigger | undefined;
};

type CiShard = { shard: number; groups: string };

export type CiPlan = {
  /** Why the plan selects every browser group, or undefined for a selection by diff. */
  fullReason: string | undefined;
  /** Every selected browser group with the reason for it. */
  browser: { id: string; reason: string }[];
  shards: CiShard[];
};

/**
 * Changes that can alter how every group installs, builds or runs: the
 * dependencies, the build and Playwright configuration, the local stack's
 * configuration, and the CI workflow and its actions. With `runnerModules`
 * they are the tooling inputs. CI cannot map them to a scope, so a change to
 * one runs everything (fail open).
 */
const TOOLING_INPUTS =
  /^(package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|next\.config\.ts|playwright(\.[a-z-]+)?\.config\.ts|supabase\/config\.toml|\.github\/(workflows\/ci\.yml|actions\/.+))$/;

/** The scripts that plan, build, serve and run every group. */
const RUNNER_ENTRY_POINTS = [
  'scripts/verify.ts',
  'scripts/run-playwright.ts',
  'scripts/playwright-preflight.ts',
  'scripts/test-server.ts',
  'scripts/build.ts',
  'scripts/ci-plan.ts',
];
const RUNNER_FOLDER = /^lib\/testing\/(runner|selection|local-stack)\//;

/**
 * The runner entry points and the runner, selection and local-stack modules
 * they import, directly or through other modules. A module only a spec, a static check or a unit test imports
 * selects its own groups instead. An import the graph cannot resolve takes
 * every module of those folders.
 */
export function runnerModules(graph: ReadonlyMap<string, readonly string[]>): string[] {
  const reached = new Set<string>();
  const pending = [...RUNNER_ENTRY_POINTS];
  while (pending.length) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    if (file === UNKNOWN_IMPORT_DEPENDENCY)
      pending.push(...[...graph.keys()].filter((candidate) => RUNNER_FOLDER.test(candidate)));
    else pending.push(...(graph.get(file) ?? []));
  }
  return [...reached].filter((file) => RUNNER_ENTRY_POINTS.includes(file) || RUNNER_FOLDER.test(file));
}

/** The visual groups drive a browser in the pinned Playwright image and run for many minutes, so each takes a shard of its own. */
const VISUAL_GROUP = /^audit:visual(:|$)/;

/** A browser shard holds about this many groups; a typical change then finishes in one shard round. */
const GROUPS_PER_SHARD = 4;
/** GitHub's free plan runs 20 jobs at once; the static, unit, SQL and component jobs keep the rest. */
export const MAX_SHARDS = 14;

const isBrowser = (group: CiGroup): boolean => group.kind === 'golden' || group.kind === 'audit';

/**
 * The browser groups a CI run executes, split into shards. A full run (the
 * nightly run, the release gate, an unreadable diff or a tooling change)
 * takes every browser group except the wall-clock `audit:performance:*`
 * groups, whose medians follow a shared runner's load
 * (docs/technical/performance.md). A pull request and a push to `main` take
 * the change-mode selection of `groupSelections` for their diff against the
 * base (a push's previous `main` commit): the critical journeys, the
 * permission groups by scope, and the other groups only when their own test
 * code changed.
 */
export function ciPlan(input: {
  groups: readonly CiGroup[];
  /** The files the change touches, or undefined when the diff could not be read. */
  changedFiles: readonly string[] | undefined;
  /** Set for a call with `full`: the nightly run and the release gate. */
  fullRun: string | undefined;
  /** The output of `runnerModules`. */
  runnerModules: readonly string[];
}): CiPlan {
  const browserGroups = input.groups.filter(
    (group) => isBrowser(group) && !group.files.some(isPerformanceSpec),
  );
  const runner = new Set(input.runnerModules);
  const tooling = input.changedFiles?.find((file) => TOOLING_INPUTS.test(file) || runner.has(file));
  const fullReason =
    input.fullRun ??
    (input.changedFiles === undefined
      ? 'The diff against the base could not be read'
      : tooling
        ? `Tooling input changed: ${tooling}`
        : undefined);
  const browser =
    fullReason !== undefined || input.changedFiles === undefined
      ? browserGroups.map((group) => ({ id: group.id, reason: fullReason ?? 'Full run' }))
      : // Every browser group's support counts as shared; the plan then never runs a wall-clock group.
        changeSelection(input.groups.filter(isBrowser), input.changedFiles).filter((entry) =>
          browserGroups.some((group) => group.id === entry.id),
        );
  return { fullReason, browser, shards: shardsOf(browser.map((entry) => entry.id)) };
}

function changeSelection(
  groups: readonly CiGroup[],
  changedFiles: readonly string[],
): { id: string; reason: string }[] {
  const selections = groupSelections({
    mode: 'change',
    groups: groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      scopes: group.scopes,
      executionInputs: group.executionInputs,
      trigger: group.trigger,
    })),
    changedFiles,
    unresolvedGroupIds: [],
  });
  return groups.flatMap((group) => {
    const selection = selections.get(group.id);
    return selection
      ? [{ id: group.id, reason: `${selection.reason} (${selection.changedFiles[0] ?? 'no file'})` }]
      : [];
  });
}

/**
 * A shard of its own for each visual group, then the other groups dealt round-robin into as few
 * shards as hold about GROUPS_PER_SHARD each, within the job budget.
 */
function shardsOf(groupIds: readonly string[]): CiShard[] {
  const visual = groupIds.filter((id) => VISUAL_GROUP.test(id));
  const rest = groupIds.filter((id) => !VISUAL_GROUP.test(id));
  // At least one shard for the other groups, so a large visual selection can never drop them.
  const count = rest.length
    ? Math.max(1, Math.min(MAX_SHARDS - visual.length, Math.ceil(rest.length / GROUPS_PER_SHARD)))
    : 0;
  const shards = [...visual.map((id) => [id]), ...Array.from({ length: count }, (): string[] => [])];
  rest.forEach((id, index) => shards[visual.length + (index % count)]?.push(id));
  return shards.map((groups, index) => ({ shard: index + 1, groups: groups.join(',') }));
}
