import ts from 'typescript';
import { CI_JOBS, type CiJob } from '../ci/dag';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import type { DependencyChange } from './dependency-change';
import { groupSelections, RUNNER_PILOTS } from './group-selection';
import type { ChangeTrigger } from './change-triggers';
import type { GroupDurations } from './group-durations';
import { isPerformanceSpec } from './test-groups';
import { z } from 'zod';

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

/** The fast tier's kinds a tooling input can take whole: component areas, SQL groups, static gates. */
type FastKind = 'ui' | 'sql' | 'static';

/** What the change's tooling inputs run (owner decision D3, werk-flow/werkflow-planning#503). */
type ToolingClass = {
  /** Why every group of every kind runs, or undefined. */
  everyGroup: string | undefined;
  /** Why the browser plan adds the runner pilots and one group of every shard kind, or undefined. */
  browser: string | undefined;
  /** The fast-tier kinds a tooling input takes whole, with the reason. */
  fast: Partial<Record<FastKind, string>>;
  /** Why a tooling input of the `invoices` job runs the e-invoice check (e-invoice-selection.ts), or undefined. */
  invoices: string | undefined;
  /** Dependency files whose change moves only lint and type packages: they select no group. */
  lintOnly: string[];
};

export type CiPlan = {
  /** Why the plan selects every browser group, or undefined for a selection by diff. */
  fullReason: string | undefined;
  /** Every selected browser group with the reason for it. */
  browser: { id: string; reason: string }[];
  shards: CiShard[];
  tooling: ToolingClass;
};

/**
 * Inputs that change how every group builds, serves or runs: the Next.js, PostCSS, TypeScript and
 * Playwright configuration, the local stack's configuration, and the patches of installed packages.
 * A change to one runs every group (D3). So does a runtime or Playwright dependency
 * (dependency-change.ts).
 */
const EVERY_GROUP_INPUTS =
  /^(next\.config\.ts|postcss\.config\.mjs|tsconfig\.json|playwright[^/]*\.config\.ts|supabase\/config\.toml|patches\/.+)$/;
/**
 * The CI workflow and the CI mirror's (ci/mirror/workflow.yml), the job bodies and logic
 * (scripts/ci/, lib/testing/ci/, without their tests) and Bun's test configuration. With `runnerModules` they are the tooling inputs: a change to one runs
 * its affected groups, the runner pilots, one browser group of every shard kind, every fast-tier
 * group and the e-invoice check, and main's full run starts right after its merge
 * (lib/testing/ci/full-run.ts).
 */
const TOOLING_INPUTS =
  /^(bunfig\.toml|\.github\/workflows\/ci\.yml|ci\/mirror\/workflow\.yml|(scripts|lib\/testing)\/ci\/[a-z-]+\.ts)$/;
const DEPENDENCY_FILES = ['package.json', 'bun.lock'];
/** A file of a composite action: `.github/actions/<name>/…`. */
const ACTION_FILE = /^\.github\/actions\/([^/]+)\//;

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

/**
 * The job bodies and environment steps every CI workflow job calls (scripts/ci/job.ts,
 * scripts/ci/prepare.ts); they name the scripts a job runs.
 */
export const CI_JOB_BODIES = ['scripts/ci/job.ts', 'scripts/ci/run.ts', 'scripts/ci/prepare.ts'];

/** The root package's scripts `bun install` runs. */
const INSTALL_LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * The repository scripts CI's workflow, actions and job bodies run: each `scripts/<name>.ts` they
 * name, and the scripts a package script reaches (`bun run <name>`, a job body's
 * `['run', '<name>']`, or the lifecycle scripts of `bun install` or a body's `['install', …]`),
 * chains included. A change to one changes how CI sets up or runs, so it counts as a tooling input.
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
    if (/\bbun install\b|\['install', /.test(text)) for (const name of INSTALL_LIFECYCLE) readScript(name);
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
 * The browser shard kinds a tooling change samples, one group each: each kind runs in its own way
 * (the pinned image, the sweeps, the measured counts, the journeys every product change runs).
 */
const SHARD_KINDS: readonly { kind: string; holds: (group: CiGroup) => boolean }[] = [
  { kind: 'visual', holds: (group) => VISUAL_GROUP.test(group.id) },
  { kind: 'layout', holds: (group) => /^audit:layout(:|$)/.test(group.id) },
  { kind: 'lab', holds: (group) => group.trigger === 'product' },
  { kind: 'critical', holds: (group) => group.trigger === 'critical' },
];

/** The fast-tier kinds each CI job runs whole for a tooling input; Plan, Check and the midnight wait run in every run. */
const FAST_KINDS_OF_JOB: Readonly<Partial<Record<CiJob, readonly FastKind[]>>> = {
  fast: ['static'],
  sql: ['sql'],
  components: ['ui'],
};

/**
 * What the changed tooling inputs run. A row-only registry change is none. A dependency file counts
 * by `dependencies` (dependency-change.ts), and as every group without an entry there. An action
 * takes the fast-tier kinds of the CI jobs that use it (`actionJobs`; every job without an entry)
 * and the browser sample.
 */
function toolingClass(input: {
  changedFiles: readonly string[];
  runnerModules: readonly string[];
  rowChanges: readonly string[];
  dependencies: Readonly<Record<string, DependencyChange>>;
  actionJobs: Readonly<Record<string, readonly CiJob[]>>;
}): ToolingClass {
  const tooling: ToolingClass = {
    everyGroup: undefined,
    browser: undefined,
    fast: {},
    invoices: undefined,
    lintOnly: [],
  };
  const runner = new Set(input.runnerModules);
  const runs = (reason: string, jobs: readonly CiJob[]): void => {
    if (jobs.includes('browser')) tooling.browser ??= reason;
    if (jobs.includes('invoices')) tooling.invoices ??= reason;
    for (const kind of jobs.flatMap((job) => FAST_KINDS_OF_JOB[job] ?? [])) tooling.fast[kind] ??= reason;
  };
  for (const file of input.changedFiles) {
    if (input.rowChanges.includes(file)) continue;
    const action = ACTION_FILE.exec(file)?.[1];
    const dependency = DEPENDENCY_FILES.includes(file)
      ? (input.dependencies[file] ?? { effect: 'every-group', reason: `${file}: not classified` })
      : undefined;
    if (EVERY_GROUP_INPUTS.test(file)) tooling.everyGroup ??= `Every group runs for ${file}`;
    else if (dependency?.effect === 'every-group')
      tooling.everyGroup ??= `Every group runs for ${dependency.reason}`;
    else if (dependency?.effect === 'lint-type') {
      // A type package can break the type check, whatever else the diff holds.
      tooling.lintOnly.push(file);
      tooling.fast.static ??= `Lint or type packages moved: ${dependency.reason}`;
    } else if (dependency) runs(`Tooling input changed: ${dependency.reason}`, CI_JOBS);
    else if (action !== undefined) {
      const jobs = input.actionJobs[action] ?? CI_JOBS;
      // Any job's setup can change the build the browser shards serve, so the sample runs too.
      runs(`Tooling input changed: ${file}, used by ${jobs.join(', ')}`, [...jobs, 'browser']);
    } else if (TOOLING_INPUTS.test(file) || runner.has(file)) runs(`Tooling input changed: ${file}`, CI_JOBS);
  }
  return tooling;
}

/**
 * The CI jobs of `ci.yml` that use each composite action under `.github/actions/`, directly or
 * through another action; an action no CI job uses has no entry. `workflow` is ci.yml's text and
 * `actions` each `action.yml` text by its directory name; a text that is no workflow or action, or a
 * workflow without every CI job, throws, so the plan stops.
 */
export function actionJobsOf(
  workflow: string,
  actions: Readonly<Record<string, string>>,
): Record<string, CiJob[]> {
  const stepsSchema = z.array(z.object({ uses: z.string().optional() })).optional();
  const uses = (steps: z.infer<typeof stepsSchema>): string[] =>
    (steps ?? []).flatMap((step) => {
      const name = /^\.\/\.github\/actions\/([^/]+)$/.exec(step.uses ?? '')?.[1];
      return name === undefined ? [] : [name];
    });
  const jobs = z
    .object({ jobs: z.record(z.string(), z.object({ steps: stepsSchema })) })
    .parse(Bun.YAML.parse(workflow)).jobs;
  const nested = Object.fromEntries(
    Object.entries(actions).map(([name, text]) => [
      name,
      uses(z.object({ runs: z.object({ steps: stepsSchema }) }).parse(Bun.YAML.parse(text)).runs.steps),
    ]),
  );
  const missing = CI_JOBS.filter((job) => !jobs[job]);
  if (missing.length) throw new Error(`ci.yml has no job ${missing.join(', ')}.`);
  const users: Record<string, CiJob[]> = {};
  for (const job of CI_JOBS) {
    const pending = uses(jobs[job]?.steps);
    const seen = new Set<string>();
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (seen.has(name)) continue;
      seen.add(name);
      (users[name] ??= []).push(job);
      pending.push(...(nested[name] ?? []));
    }
  }
  return users;
}

/**
 * The browser groups a CI run executes, split into shards. A full run (the nightly run, the release
 * gate, an unreadable diff or an every-group input of `toolingClass`) takes every browser group
 * except the wall-clock `audit:performance:*` groups, whose medians follow a shared runner's load
 * (docs/technical/performance.md). Only a full run by name adds them, and every shard runs
 * `--untimed`, so they prove their steps and judge no timing. A pull request and a push to `main`
 * take the change-mode selection of `groupSelections` for their diff against the base (a push's
 * previous `main` commit): the critical journeys, the lab groups, the permission groups by scope,
 * and the other groups only when their own test code changed. A tooling change adds the runner
 * pilots and the shortest recorded group of each shard kind the selection lacks (owner decision
 * D3); main's full run right after the merge takes the rest.
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
  /** The effect of each changed dependency file (dependency-change.ts). */
  dependencies: Readonly<Record<string, DependencyChange>>;
  /** The output of `actionJobsOf`. */
  actionJobs: Readonly<Record<string, readonly CiJob[]>>;
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
  const tooling = toolingClass({ ...input, changedFiles: input.changedFiles ?? [] });
  const fullReason =
    input.fullRun ??
    (input.changedFiles === undefined ? 'The diff against the base could not be read' : tooling.everyGroup);
  const plan = (browser: { id: string; reason: string }[]): CiPlan => ({
    fullReason,
    browser,
    shards: shardsOf(
      browser.map((entry) => entry.id),
      input.durations,
    ),
    tooling,
  });
  if (fullReason !== undefined || input.changedFiles === undefined)
    return plan([
      ...browserGroups.map((group) => ({ id: group.id, reason: fullReason ?? 'Full run' })),
      ...wallClockSteps,
    ]);
  const changed = input.changedFiles.filter((file) => !tooling.lintOnly.includes(file));
  // Every browser group's support counts as shared; the plan then never runs a wall-clock group.
  const reasons = new Map(
    changeSelection(input.groups.filter(isBrowser), changed).map((entry) => [entry.id, entry.reason]),
  );
  if (tooling.browser) {
    const seconds = secondsOf(input.durations);
    for (const id of RUNNER_PILOTS)
      if (!reasons.has(id)) reasons.set(id, `Runner integration pilot (${tooling.browser})`);
    for (const { kind, holds } of SHARD_KINDS) {
      const ofKind = browserGroups.filter(holds);
      const [shortest] = ofKind.toSorted(
        (left, right) => seconds(left.id) - seconds(right.id) || left.id.localeCompare(right.id),
      );
      if (shortest && !ofKind.some((group) => reasons.has(group.id)))
        reasons.set(shortest.id, `One ${kind} group (${tooling.browser})`);
    }
  }
  return plan(
    browserGroups.flatMap((group) => {
      const reason = reasons.get(group.id);
      return reason === undefined ? [] : [{ id: group.id, reason }];
    }),
  );
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
  // Every feasible split of the slots; the shortest longest shard wins, then the fewest shards.
  const longest = (shards: string[][]): number =>
    Math.max(...shards.map((ids) => ids.reduce((sum, id) => sum + seconds(id), 0)));
  const least = { visual: visual.length ? 1 : 0, rest: rest.length ? 1 : 0 };
  const range = (from: number, to: number): number[] =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  const splits = range(least.visual, Math.min(visual.length, MAX_SHARDS - least.rest)).flatMap(
    (visualCount) =>
      range(least.rest, Math.min(rest.length, MAX_SHARDS - visualCount)).map((restCount) =>
        packed(visualCount, restCount),
      ),
  );
  return numbered(
    splits.reduce((best, split) => {
      const [left, right] = [longest(split), longest(best)];
      return left < right || (left === right && split.length < best.length) ? split : best;
    }),
  );
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
 * The planner's log lines. Every group id, reason and file name prints as one JSON string, so a newline or a
 * leading `::` in a changed path can neither start a log line nor a workflow command.
 */
export function planLog(
  plan: CiPlan,
  fastReasons: Readonly<Record<string, string>>,
  invoices: string | undefined,
): string[] {
  return [
    `[ci-plan] ${plan.fullReason ? `Full run: ${JSON.stringify(plan.fullReason)}` : plan.tooling.browser ? `Tooling sample: ${JSON.stringify(plan.tooling.browser)}` : 'Selection by diff'}; ${plan.browser.length} browser groups in ${plan.shards.length} shards.`,
    ...plan.browser.map((entry) => `  ${JSON.stringify(entry.id)} | ${JSON.stringify(entry.reason)}`),
    ...plan.shards.map((shard) => `  shard ${shard.shard}: ${JSON.stringify(shard.groups)}`),
    `[ci-plan] Fast tier: ${Object.keys(fastReasons).length} groups.`,
    ...Object.entries(fastReasons).map(
      ([id, reason]) => `  ${JSON.stringify(id)} | ${JSON.stringify(reason)}`,
    ),
    `[ci-plan] E-invoices: ${invoices === undefined ? 'no change reaches them' : JSON.stringify(invoices)}.`,
  ];
}
