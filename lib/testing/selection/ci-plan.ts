import { groupSelections } from './group-selection';
import { isPerformanceSpec, isReleaseOnlySpec } from './test-groups';

/** A group as the CI plan sees it: its id, kind, spec files and what its execution imports. */
export type CiGroup = {
  id: string;
  kind: string;
  files: readonly string[];
  scopes: readonly string[];
  executionInputs: readonly string[];
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
 * Changes that can alter how every group installs, builds or runs. CI cannot
 * map them to a scope, so a change to one runs everything (fail open).
 */
const TOOLING_INPUTS =
  /^(package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|next\.config\.ts|vercel\.json|playwright(\.[a-z-]+)?\.config\.ts|supabase\/config\.toml|\.github\/.+|scripts\/(verify|run-playwright|playwright-preflight|test-server|build|ci-plan)\.ts|lib\/testing\/(runner|selection|local-stack)\/.+)$/;

/** Product files whose rendering the visual reference and acceptance groups judge. */
const RENDERED_UI = /^(app\/.+\.(tsx|css)|components\/.+\.tsx?|hooks\/.+\.tsx?|public\/.+)$/;

/** A browser shard holds about this many groups; a typical change then finishes in one shard round. */
const GROUPS_PER_SHARD = 4;
/** GitHub's free plan runs 20 jobs at once; the static, unit, SQL and component jobs keep the rest. */
export const MAX_SHARDS = 14;

const isBrowser = (group: CiGroup): boolean => group.kind === 'golden' || group.kind === 'audit';

/**
 * The browser groups a CI run executes, split into shards. A full run (a
 * push to `main`, the nightly run, an unreadable diff or a tooling change)
 * takes every browser group except the wall-clock `audit:performance:*`
 * groups, whose medians follow a shared runner's load
 * (docs/technical/performance.md). A pull request takes the change-mode
 * selection of `groupSelections` for its diff against the base, and the
 * visual groups when it changes rendered UI.
 */
export function ciPlan(input: {
  groups: readonly CiGroup[];
  /** The files the change touches, or undefined when the diff could not be read. */
  changedFiles: readonly string[] | undefined;
  /** Set for a push to `main`, the nightly run and a manual run. */
  fullRun: string | undefined;
}): CiPlan {
  const browserGroups = input.groups.filter(
    (group) => isBrowser(group) && !group.files.some(isPerformanceSpec),
  );
  const tooling = input.changedFiles?.find((file) => TOOLING_INPUTS.test(file));
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
      : changeSelection(browserGroups, input.changedFiles);
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
      releaseOnly: group.files.some(isReleaseOnlySpec),
    })),
    changedFiles,
    unresolvedGroupIds: [],
  });
  const renderedUi = changedFiles.find((file) => RENDERED_UI.test(file));
  return groups.flatMap((group) => {
    const selection = selections.get(group.id);
    if (selection)
      return [{ id: group.id, reason: `${selection.reason} (${selection.changedFiles[0] ?? 'no file'})` }];
    if (renderedUi && group.files.some(isReleaseOnlySpec))
      return [{ id: group.id, reason: `Rendered UI changed (${renderedUi})` }];
    return [];
  });
}

/** Deals the groups round-robin into as few shards as hold about GROUPS_PER_SHARD each. */
function shardsOf(groupIds: readonly string[]): CiShard[] {
  const count = Math.min(MAX_SHARDS, Math.ceil(groupIds.length / GROUPS_PER_SHARD));
  const shards = Array.from({ length: count }, (): string[] => []);
  groupIds.forEach((id, index) => shards[index % count]?.push(id));
  return shards.map((groups, index) => ({ shard: index + 1, groups: groups.join(',') }));
}
