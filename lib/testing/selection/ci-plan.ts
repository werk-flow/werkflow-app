import ts from 'typescript';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { groupSelections } from './group-selection';
import type { ChangeTrigger } from './change-triggers';
import type { GroupDurations } from './group-durations';
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
  /** A layout sweep's rendered product files (surface-closure.ts). */
  renderedFiles?: readonly string[] | undefined;
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
 * dependencies, the build (Next.js, PostCSS) and Playwright configuration, the local stack's
 * configuration, and the CI workflow, its actions and its job bodies and logic
 * (scripts/ci/, lib/testing/ci/, without their tests). With `runnerModules`
 * they are the tooling inputs. CI cannot map them to a scope, so a change to
 * one runs everything (fail open).
 */
const TOOLING_INPUTS =
  /^(package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|next\.config\.ts|postcss\.config\.mjs|playwright(\.[a-z-]+)?\.config\.ts|supabase\/config\.toml|\.github\/(workflows\/ci\.yml|actions\/.+)|(scripts|lib\/testing)\/ci\/[a-z-]+\.ts)$/;

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

/** Every module `entries` import, directly or through other modules; an unresolved import takes every module of the runner folders. */
function reachedFrom(graph: ReadonlyMap<string, readonly string[]>, entries: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const pending = [...entries];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    if (file === UNKNOWN_IMPORT_DEPENDENCY)
      pending.push(...[...graph.keys()].filter((candidate) => RUNNER_FOLDER.test(candidate)));
    else pending.push(...(graph.get(file) ?? []));
  }
  return reached;
}

/**
 * The runner entry points, the scripts CI runs (`scriptsCiRuns`), and the scripts and the runner,
 * selection and local-stack modules they import, directly or through other modules. The plan also counts the
 * evidence modules the planner imports: they build the import graph that decides what a run leaves
 * out. A module
 * only a spec, a static check or a unit test imports selects its own groups instead.
 */
export function runnerModules(
  graph: ReadonlyMap<string, readonly string[]>,
  ciScripts: readonly string[],
): string[] {
  const entries = [...RUNNER_ENTRY_POINTS, ...ciScripts];
  const runner = [...reachedFrom(graph, entries)].filter(
    (file) => entries.includes(file) || file.startsWith('scripts/') || RUNNER_FOLDER.test(file),
  );
  const planner = [...reachedFrom(graph, ['scripts/ci-plan.ts'])].filter((file) =>
    file.startsWith('lib/testing/evidence/'),
  );
  return [...new Set([...runner, ...planner])];
}

/** The job bodies every CI workflow job calls (scripts/ci/job.ts); they name the scripts a job runs. */
export const CI_JOB_BODIES = ['scripts/ci/job.ts', 'scripts/ci/run.ts'];

/** The root package's scripts `bun install` runs. */
const INSTALL_LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * The repository scripts CI's workflow, actions and job bodies run: each `scripts/<name>.ts` they
 * name, and the scripts a package script reaches (`bun run <name>`, a job body's
 * `['run', '<name>']`, or `bun install`'s lifecycle scripts), chains included. A change to one changes how CI sets up or runs, so it
 * counts as a tooling input.
 */
export function scriptsCiRuns(
  sources: readonly string[],
  packageScripts: Readonly<Record<string, string>>,
): string[] {
  const scripts = new Set<string>();
  const seen = new Set<string>();
  const readScript = (name: string | undefined): void => {
    if (name === undefined || seen.has(name) || !Object.hasOwn(packageScripts, name)) return;
    seen.add(name);
    read(packageScripts[name] ?? '');
  };
  const read = (text: string): void => {
    for (const match of text.matchAll(/(?<![\w./-])scripts\/[\w./-]+\.ts\b/g)) scripts.add(match[0]);
    for (const [, name] of text.matchAll(/(?:\bbun run |\['run', ')([\w:-]+)/g)) readScript(name);
    if (/\bbun install\b/.test(text)) for (const name of INSTALL_LIFECYCLE) readScript(name);
  };
  for (const source of sources) read(source);
  return [...scripts].sort();
}

/**
 * The declarations of the runner's registries that hold only the rows a feature adds: test groups
 * and scope prefixes, dialogs, phone routes. A row changes which groups exist or what they open, not
 * how every group runs, so a change inside these alone plans by diff: a new group's spec selects
 * it, the runner integration pilots run, and the SQL and static jobs take every registered group.
 * What a diff misses runs in main's full run within hours. Every other statement of these modules
 * stays runner logic. As runner logic, rows ran every browser group for 13 of 45 merged PRs
 * (werk-flow/werkflow-planning#294).
 */
export const REGISTRY_ROWS: Readonly<Record<string, readonly string[]>> = {
  'lib/testing/selection/test-groups.ts': ['TEST_SCOPE_PREFIXES', 'auditDefinitions', 'sqlDefinitions'],
  'lib/testing/selection/component-areas.ts': ['COMPONENT_AREAS'],
  'lib/testing/selection/dialog-inventory.ts': ['DIALOG_INVENTORY'],
  'lib/testing/selection/mobile-route-inventory.ts': [
    'MANAGER_PHONE_ROUTES',
    'DYNAMIC_PHONE_ROUTES',
    'PHONE_REDIRECTS',
    'EMPLOYEE_PHONE_ROUTES',
    'EMPLOYEE_WORK_PACKS',
  ],
};

/** Whether a registry's two versions differ only inside its `REGISTRY_ROWS`; comments do not count. */
export function changesOnlyRows(file: string, before: string, after: string): boolean {
  const rows = REGISTRY_ROWS[file];
  if (!rows) return false;
  const logic = (source: string): string[] => {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
    return tree.statements.map((statement) => {
      const [declaration, ...more] = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
        : [];
      return declaration &&
        !more.length &&
        ts.isIdentifier(declaration.name) &&
        rows.includes(declaration.name.text)
        ? `rows ${declaration.name.text}: ${declaration.type?.getText(tree) ?? ''}`
        : statement.getText(tree);
    });
  };
  return JSON.stringify(logic(before)) === JSON.stringify(logic(after));
}

/** The visual groups render in the pinned Playwright image, which a runner pulls first, so they share shards of their own. */
const VISUAL_GROUP = /^audit:visual(:|$)/;
/**
 * A browser shard holds about this many seconds of tests by the recorded durations
 * (group-durations.ts), besides a setup of about 5 min (disk, install, stack, Playwright). A
 * selection takes as few shards as hold it at this, so a product change's critical journeys and lab
 * groups (about 9 min) pay one setup, and a full run spreads evenly over `MAX_SHARDS`.
 */
export const TARGET_SHARD_SECONDS = 15 * 60;
/**
 * A selection never takes more shards than this. A full one fills them: the visual ones and the
 * others, each with about 13 to 20 min of tests (werk-flow/werkflow-planning#505). Fewer would take
 * the slowest shard past the Browser job's 45 min timeout.
 */
export const MAX_SHARDS = 8;
/** The component areas of a full set split into at most this many jobs of about this many seconds each. */
const COMPONENT_SHARDS = 2;
const COMPONENT_SHARD_SECONDS = 8 * 60;

const isBrowser = (group: CiGroup): boolean => group.kind === 'golden' || group.kind === 'audit';

/**
 * The browser groups a CI run executes, split into shards. A full run (the
 * nightly run, the release gate, an unreadable diff or a tooling change)
 * takes every browser group except the wall-clock `audit:performance:*`
 * groups, whose medians follow a shared runner's load
 * (docs/technical/performance.md). Only the nightly run and the release gate
 * add them, and every shard runs `--untimed`, so they prove their steps and
 * judge no timing. A pull request and a push to `main` take
 * the change-mode selection of `groupSelections` for their diff against the
 * base (a push's previous `main` commit): the critical journeys, the lab
 * groups, the permission groups by scope, and the other groups only when their
 * own test code changed.
 */
export function ciPlan(input: {
  groups: readonly CiGroup[];
  /** The files the change touches, or undefined when the diff could not be read. */
  changedFiles: readonly string[] | undefined;
  /** Set for a call with `full`: the nightly run and the release gate. */
  fullRun: string | undefined;
  /** The output of `runnerModules`. */
  runnerModules: readonly string[];
  /** The changed registries whose change `changesOnlyRows` holds to their rows. */
  rowChanges: readonly string[];
  /** The recorded group durations the shards are packed by. */
  durations: GroupDurations;
}): CiPlan {
  const browserGroups = input.groups.filter(
    (group) => isBrowser(group) && !group.files.some(isPerformanceSpec),
  );
  const wallClockSteps =
    input.fullRun === undefined
      ? []
      : input.groups
          .filter((group) => isBrowser(group) && group.files.some(isPerformanceSpec))
          .map((group) => ({ id: group.id, reason: `${input.fullRun}: its steps, untimed` }));
  const runner = new Set(input.runnerModules);
  const tooling = input.changedFiles?.find(
    (file) => (TOOLING_INPUTS.test(file) || runner.has(file)) && !input.rowChanges.includes(file),
  );
  const fullReason =
    input.fullRun ??
    (input.changedFiles === undefined
      ? 'The diff against the base could not be read'
      : tooling
        ? `Tooling input changed: ${tooling}`
        : undefined);
  const browser =
    fullReason !== undefined || input.changedFiles === undefined
      ? [
          ...browserGroups.map((group) => ({ id: group.id, reason: fullReason ?? 'Full run' })),
          ...wallClockSteps,
        ]
      : // Every browser group's support counts as shared; the plan then never runs a wall-clock group.
        changeSelection(input.groups.filter(isBrowser), input.changedFiles).filter((entry) =>
          browserGroups.some((group) => group.id === entry.id),
        );
  return {
    fullReason,
    browser,
    shards: shardsOf(
      browser.map((entry) => entry.id),
      input.durations,
    ),
  };
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
      renderedFiles: group.renderedFiles,
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
 * Packs the groups into `count` shards, longest first, each onto the shard with the least recorded
 * time so far, then the fewest groups, then the lower shard; equal durations go by id. The same selection therefore
 * always packs alike, whatever its order. A shard lists its groups in selection order.
 */
function pack(groupIds: readonly string[], count: number, seconds: (id: string) => number): string[][] {
  const loads = Array.from({ length: count }, () => ({ seconds: 0, groups: new Set<string>() }));
  const longestFirst = [...groupIds].sort(
    (left, right) => seconds(right) - seconds(left) || left.localeCompare(right),
  );
  for (const id of longestFirst) {
    // On equal time the shard with fewer groups wins, so a zero-second group never leaves a shard empty.
    const lightest = loads.reduce((best, load) =>
      load.seconds < best.seconds || (load.seconds === best.seconds && load.groups.size < best.groups.size)
        ? load
        : best,
    );
    lightest.seconds += seconds(id);
    lightest.groups.add(id);
  }
  return loads.map((load) => groupIds.filter((id) => load.groups.has(id)));
}

const secondsOf =
  (durations: GroupDurations) =>
  (id: string): number =>
    durations.groups[id] ?? durations.defaultSeconds;

/** How many shards of `targetSeconds` the groups fill, at least one. */
function shardCount(
  groupIds: readonly string[],
  seconds: (id: string) => number,
  targetSeconds: number,
): number {
  const total = groupIds.reduce((sum, id) => sum + seconds(id), 0);
  return Math.max(1, Math.ceil(total / targetSeconds));
}

/**
 * The visual groups in shards of their own, then the other groups, each packed into as few shards
 * as hold `TARGET_SHARD_SECONDS` each, never more shards than groups. When those counts pass
 * `MAX_SHARDS`, each pool keeps at least one shard and the budget goes to the split whose longest
 * shard is shortest; a tie keeps fewer visual shards.
 */
function shardsOf(groupIds: readonly string[], durations: GroupDurations): CiShard[] {
  const seconds = secondsOf(durations);
  const visual = groupIds.filter((id) => VISUAL_GROUP.test(id));
  const rest = groupIds.filter((id) => !VISUAL_GROUP.test(id));
  const wanted = (ids: readonly string[]): number =>
    ids.length ? Math.min(ids.length, shardCount(ids, seconds, TARGET_SHARD_SECONDS)) : 0;
  const packed = (visualCount: number, restCount: number): string[][] => [
    ...pack(visual, visualCount, seconds),
    ...pack(rest, restCount, seconds),
  ];
  const target = { visual: wanted(visual), rest: wanted(rest) };
  if (target.visual + target.rest <= MAX_SHARDS) return numbered(packed(target.visual, target.rest));
  const longest = (shards: string[][]): number =>
    Math.max(...shards.map((ids) => ids.reduce((sum, id) => sum + seconds(id), 0)));
  const lowest = visual.length ? 1 : 0;
  const highest = Math.min(target.visual, MAX_SHARDS - (rest.length ? 1 : 0));
  const splits = Array.from({ length: highest - lowest + 1 }, (_, index) =>
    packed(lowest + index, Math.min(target.rest, MAX_SHARDS - lowest - index)),
  );
  return numbered(splits.reduce((best, split) => (longest(split) < longest(best) ? split : best)));
}

/** The selected component areas in at most `COMPONENT_SHARDS` jobs, packed like the browser shards. */
export function componentShards(groupIds: readonly string[], durations: GroupDurations): CiShard[] {
  if (!groupIds.length) return [];
  const seconds = secondsOf(durations);
  const count = Math.min(
    COMPONENT_SHARDS,
    groupIds.length,
    shardCount(groupIds, seconds, COMPONENT_SHARD_SECONDS),
  );
  return numbered(pack(groupIds, count, seconds));
}

const numbered = (shards: readonly string[][]): CiShard[] =>
  shards.map((groups, index) => ({ shard: index + 1, groups: groups.join(',') }));

/**
 * The planner's log lines. Every reason and file name prints as one JSON string, so a newline or a
 * leading `::` in a changed path can neither start a log line nor a workflow command.
 */
export function planLog(plan: CiPlan, fastReasons: Readonly<Record<string, string>>): string[] {
  return [
    `[ci-plan] ${plan.fullReason ? `Full run: ${JSON.stringify(plan.fullReason)}` : 'Selection by diff'}; ${plan.browser.length} browser groups in ${plan.shards.length} shards.`,
    ...plan.browser.map((entry) => `  ${entry.id} | ${JSON.stringify(entry.reason)}`),
    ...plan.shards.map((shard) => `  shard ${shard.shard}: ${shard.groups}`),
    `[ci-plan] Fast tier: ${Object.keys(fastReasons).length} groups.`,
    ...Object.entries(fastReasons).map(([id, reason]) => `  ${id} | ${JSON.stringify(reason)}`),
  ];
}
