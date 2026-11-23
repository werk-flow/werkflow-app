// CI runs the browser groups a change can break, and everything when it cannot tell.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { CI_JOBS } from '../ci/dag';
import {
  actionJobsOf,
  CI_JOB_BODIES,
  changesOnlyRows,
  ciPlan,
  componentShards,
  MAX_SHARDS,
  planLog,
  TARGET_SHARD_SECONDS,
  REGISTRY_ROWS,
  runnerModules as runnerModulesOf,
  scriptsCiRuns,
  type CiGroup,
} from './ci-plan';
import { CRITICAL_JOURNEYS, type ChangeTrigger } from './change-triggers';
import type { DependencyChange } from './dependency-change';
import { RUNNER_PILOTS } from './group-selection';
import { readGroupDurations, type GroupDurations } from './group-durations';
import { getTestGroups } from './test-groups';
import { z } from '@/lib/zod';
import { workflowsFolder } from '../ci-workflow';

const group = (id: string, file: string, scopes: string[], trigger?: ChangeTrigger): CiGroup => ({
  id,
  kind: id.startsWith('golden:') ? 'golden' : (id.split(':')[0] ?? 'audit'),
  files: [file],
  scopes,
  executionInputs: [file],
  trigger,
});
const groups: CiGroup[] = [
  group('static:lint', 'eslint.config.mjs', ['*']),
  group('golden:gg-00', 'tests/golden/gg-00.spec.ts', ['*'], 'critical'),
  group('golden:p1-04', 'tests/golden/p1-04.spec.ts', ['personnel', 'time'], 'own-test'),
  group('audit:wave-2:p1-13', 'tests/audit/wave-2/p1-13.spec.ts', ['work', 'inventory'], 'scope'),
  group(
    'audit:performance:calendar',
    'tests/audit/performance/calendar.spec.ts',
    ['planning'],
    'release-only',
  ),
  group('audit:visual', 'tests/audit/visual/references.spec.ts', ['*'], 'release-only'),
  group('audit:visual:acceptance:sets', 'tests/audit/visual/acceptance-sets.spec.ts', ['*'], 'release-only'),
];
// What the runner entry points import, and two selection modules only a spec or a static check imports.
const graph = new Map<string, string[]>([
  [
    'scripts/verify.ts',
    ['lib/testing/evidence/group-qualification.ts', 'lib/testing/selection/group-selection.ts'],
  ],
  ['lib/testing/evidence/group-qualification.ts', ['lib/testing/runner/app-port.ts']],
  ['lib/testing/selection/group-selection.ts', ['lib/testing/selection/test-groups.ts']],
  ['tests/audit/layout/surfaces-work.spec.ts', ['lib/testing/selection/surface-groups.ts']],
  ['scripts/check-test-coverage.ts', ['lib/testing/selection/coverage-map.ts']],
  ['lib/testing/selection/surface-groups.ts', []],
  ['lib/testing/selection/coverage-map.ts', []],
]);
const runnerModules = runnerModulesOf(graph, []);
const repositoryRoot = resolve(import.meta.dir, '../../..');
const durations: GroupDurations = { source: 'test', defaultSeconds: 60, groups: {} };
const ids = (plan: ReturnType<typeof ciPlan>): string[] => plan.browser.map((entry) => entry.id);
const planFor = (
  changedFiles: readonly string[] | undefined,
  options: Partial<Parameters<typeof ciPlan>[0]> = {},
): ReturnType<typeof ciPlan> =>
  ciPlan({
    groups,
    changedFiles,
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
    dependencies: {},
    actionJobs: {},
    ...options,
  });
const EVERY_BROWSER_GROUP = [
  'golden:gg-00',
  'golden:p1-04',
  'audit:wave-2:p1-13',
  'audit:visual',
  'audit:visual:acceptance:sets',
];

test('an unreadable diff and an every-group input run every browser group except the wall-clock ones', () => {
  const unreadable = planFor(undefined);
  expect(unreadable.fullReason).toBe('The diff against the base could not be read');
  expect(ids(unreadable)).toEqual(EVERY_BROWSER_GROUP);
  const runtime: DependencyChange = {
    effect: 'every-group',
    reason: 'package.json: runtime dependency next',
  };
  for (const [file, dependencies] of [
    ['next.config.ts', {}],
    ['postcss.config.mjs', {}],
    ['tsconfig.json', {}],
    ['playwright.config.ts', {}],
    ['playwright.visual.config.ts', {}],
    ['playwright-ci.config.ts', {}],
    ['playwright.ci.smoke.config.ts', {}],
    ['supabase/config.toml', {}],
    ['patches/@supabase%2Fssr@0.7.0.patch', {}],
    ['package.json', { 'package.json': runtime }],
    // A dependency file the planner could not classify runs every group.
    ['bun.lock', {}],
  ] as const) {
    const plan = planFor([file], { dependencies });
    expect([file, plan.fullReason?.startsWith('Every group runs for'), ids(plan)]).toEqual([
      file,
      true,
      EVERY_BROWSER_GROUP,
    ]);
  }
});

// The sampled kinds: each fixture kind holds a longer and a shorter group, and the runner pilots.
const sampled: CiGroup[] = [
  ...groups,
  group('audit:layout:work', 'tests/audit/layout/surfaces-work.spec.ts', ['work'], 'release-only'),
  group('audit:layout:time', 'tests/audit/layout/surfaces-time.spec.ts', ['time'], 'release-only'),
  group('audit:lab:office', 'tests/audit/lab/office.spec.ts', ['work'], 'product'),
  group('golden:p1-21', 'tests/golden/p1-21.spec.ts', ['time'], 'critical'),
  group('golden:p1-24a', 'tests/golden/p1-24a.spec.ts', ['personnel'], 'own-test'),
  group('audit:wave-3:p1-24a', 'tests/audit/wave-3/p1-24a.spec.ts', ['personnel'], 'own-test'),
];
const sampledDurations: GroupDurations = {
  source: 'test',
  defaultSeconds: 60,
  groups: {
    'audit:visual': 300,
    'audit:visual:acceptance:sets': 30,
    'audit:layout:time': 20,
    'golden:p1-21': 10,
  },
};
// In the fixture's order, as the plan lists its groups.
const SAMPLE = [
  'audit:visual:acceptance:sets',
  'audit:layout:time',
  'audit:lab:office',
  'golden:p1-21',
  'golden:p1-24a',
  'audit:wave-3:p1-24a',
];

test('a tooling change runs its affected groups, the runner pilots and the shortest group of every shard kind', () => {
  for (const file of [
    'bunfig.toml',
    '.github/workflows/ci.yml',
    'ci/mirror/workflow.yml',
    'scripts/ci/job.ts',
    'lib/testing/ci/run-plan.ts',
    'lib/testing/runner/app-port.ts',
    'lib/testing/selection/test-groups.ts',
    // An action without a known user counts as used by every job.
    '.github/actions/setup/action.yml',
  ]) {
    const plan = planFor([file], { groups: sampled, durations: sampledDurations });
    expect([file, plan.fullReason, ids(plan)]).toEqual([file, undefined, SAMPLE]);
    const reason = `Tooling input changed: ${file}${file.startsWith('.github/actions/') ? `, used by ${CI_JOBS.join(', ')}` : ''}`;
    expect(plan.tooling).toEqual({
      everyGroup: undefined,
      browser: reason,
      fast: { ui: reason, sql: reason, static: reason },
      invoices: reason,
      lintOnly: [],
    });
  }
  // A kind the change already selects adds no sample of it; the change's own groups stay.
  const visual = planFor(['scripts/ci/job.ts', 'tests/audit/visual/references.spec.ts'], {
    groups: sampled,
    durations: sampledDurations,
  });
  expect(ids(visual)).toEqual(
    [...SAMPLE.filter((id) => id !== 'audit:visual:acceptance:sets'), 'audit:visual'].sort(
      byOrderIn(sampled),
    ),
  );
  // A product change beside it keeps its whole selection.
  expect(
    ids(
      planFor(['scripts/ci/job.ts', 'lib/inventory/stock.ts'], {
        groups: sampled,
        durations: sampledDurations,
      }),
    ),
  ).toEqual([...SAMPLE, 'golden:gg-00', 'audit:wave-2:p1-13'].sort(byOrderIn(sampled)));
});

const byOrderIn =
  (list: readonly CiGroup[]) =>
  (left: string, right: string): number =>
    list.findIndex((entry) => entry.id === left) - list.findIndex((entry) => entry.id === right);

test('an action change runs what the CI jobs that use it run', () => {
  const actionJobs = { playwright: ['components', 'browser'], 'supabase-cli': ['sql'] } as const;
  const playwright = planFor(['.github/actions/playwright/action.yml'], {
    groups: sampled,
    durations: sampledDurations,
    actionJobs,
  });
  expect(ids(playwright)).toEqual(SAMPLE);
  expect(Object.keys(playwright.tooling.fast)).toEqual(['ui']);
  // An action only SQL uses takes every SQL group, and still the browser sample: a job's setup can
  // change what the browser shards build or serve.
  const sql = planFor(['.github/actions/supabase-cli/action.yml'], {
    groups: sampled,
    durations: sampledDurations,
    actionJobs,
  });
  expect([ids(sql), Object.keys(sql.tooling.fast)]).toEqual([SAMPLE, ['sql']]);
  expect(sql.tooling.browser).toBe(
    'Tooling input changed: .github/actions/supabase-cli/action.yml, used by sql',
  );
  // Only an action the E-invoices job uses runs the e-invoice check.
  expect([playwright.tooling.invoices, sql.tooling.invoices]).toEqual([undefined, undefined]);
  const invoices = planFor(['.github/actions/setup/action.yml'], {
    groups: sampled,
    durations: sampledDurations,
    actionJobs: { setup: ['invoices'] },
  });
  expect(invoices.tooling.invoices).toBe(
    'Tooling input changed: .github/actions/setup/action.yml, used by invoices',
  );
});

test("a dependency change that moves only lint and type packages selects no group, and a development tool's the dependency set", () => {
  const lint: DependencyChange = { effect: 'lint-type', reason: 'package.json: lint or type package eslint' };
  const lintOnly = planFor(['package.json'], { dependencies: { 'package.json': lint } });
  expect([lintOnly.fullReason, lintOnly.tooling.browser, ids(lintOnly)]).toEqual([undefined, undefined, []]);
  expect(lintOnly.tooling.lintOnly).toEqual(['package.json']);
  // Every static gate runs, even beside documentation alone: a type package can break the type check.
  expect(lintOnly.tooling.fast).toEqual({ static: `Lint or type packages moved: ${lint.reason}` });
  // A development tool selects the dependency row's groups (the critical journeys) besides the sample.
  const tool: DependencyChange = { effect: 'tooling', reason: 'package.json: development tool knip' };
  expect(ids(planFor(['package.json'], { dependencies: { 'package.json': tool } }))).toContain(
    'golden:gg-00',
  );
});

test('the registered groups hold the runner pilots and a group of every sampled shard kind', () => {
  const registered = getTestGroups(repositoryRoot).map((entry) => ({
    ...entry,
    executionInputs: entry.files,
    trigger: entry.changeTrigger,
  }));
  const plan = planFor(['scripts/ci/job.ts'], {
    groups: registered,
    durations: readGroupDurations(repositoryRoot),
  });
  const reasons = plan.browser.map((entry) => entry.reason.split(' (')[0]);
  expect(new Set(reasons)).toEqual(
    new Set([
      'Runner integration pilot',
      'One visual group',
      'One layout group',
      'One lab group',
      'One critical group',
    ]),
  );
  expect(
    ids(plan)
      .filter((id) => RUNNER_PILOTS.has(id))
      .sort(),
  ).toEqual([...RUNNER_PILOTS].sort());
});

test('the CI jobs of ci.yml that use each action, directly or through another action', () => {
  const read = (path: string): string => readFileSync(join(repositoryRoot, path), 'utf8');
  const actions = Object.fromEntries(
    readdirSync(join(repositoryRoot, '.github/actions')).map((name) => [
      name,
      read(`.github/actions/${name}/action.yml`),
    ]),
  );
  const users = actionJobsOf(read(`${workflowsFolder()}/ci.yml`), actions);
  expect(users.playwright?.toSorted()).toEqual(['browser', 'components']);
  expect(users['supabase-cli']).toEqual(users['local-stack']);
  expect(users['local-stack']?.toSorted()).toEqual(['browser', 'fast', 'sql']);
  expect(users['upload-evidence']).toEqual(users['ci-job']);
  expect(users.setup?.toSorted()).toEqual([...CI_JOBS].sort());
  expect(() => actionJobsOf('jobs: [', actions)).toThrow();
  // A workflow whose jobs were renamed is no evidence that an action is unused.
  expect(() => actionJobsOf('jobs:\n  build:\n    steps: []\n', actions)).toThrow('ci.yml has no job plan');
  expect(
    actionJobsOf(read(`${workflowsFolder()}/ci.yml`), { ...actions, unused: 'runs:\n  steps: []\n' }).unused,
  ).toBeUndefined();
});

test("the CI logic's own unit tests are no tooling input", () => {
  const plan = planFor(['lib/testing/ci/check.test.ts']);
  expect([plan.fullReason, plan.tooling.browser]).toEqual([undefined, undefined]);
});

test("the nightly run and the release gate add each wall-clock group's steps, untimed", () => {
  for (const fullRun of ['Nightly run', 'Release 0123abc']) {
    const plan = planFor([], { fullRun });
    expect(plan.fullReason).toBe(fullRun);
    expect(ids(plan)).toEqual([...EVERY_BROWSER_GROUP, 'audit:performance:calendar']);
    expect(plan.browser.at(-1)?.reason).toBe(`${fullRun}: its steps, untimed`);
    expect(plan.shards.flatMap((shard) => shard.groups.split(','))).toContain('audit:performance:calendar');
  }
});

test('a pull request or a push to main runs the critical journeys and the groups its changed files select', () => {
  const plan = planFor(['lib/inventory/stock.ts']);
  expect(plan.fullReason).toBeUndefined();
  expect(ids(plan)).toEqual(['golden:gg-00', 'audit:wave-2:p1-13']);
  expect(ids(planFor(['tests/golden/p1-04.spec.ts']))).toEqual(['golden:p1-04']);
  expect(ids(planFor(['docs/README.md']))).toEqual([]);
  expect(planFor(['docs/README.md']).shards).toEqual([]);
});

test('the runner modules are what the runner entry points import, directly or through other modules', () => {
  expect(runnerModules.sort()).toEqual([
    'lib/testing/runner/app-port.ts',
    'lib/testing/selection/group-selection.ts',
    'lib/testing/selection/test-groups.ts',
    // Every entry point counts, whether the graph lists it or not.
    'scripts/build.ts',
    'scripts/ci-plan.ts',
    'scripts/playwright-preflight.ts',
    'scripts/run-playwright.ts',
    'scripts/test-server.ts',
    'scripts/verify.ts',
  ]);
  // An import the graph cannot resolve takes every module of the runner, selection and local-stack folders.
  const unresolved = new Map([...graph, ['scripts/verify.ts', [UNKNOWN_IMPORT_DEPENDENCY]]]);
  expect(runnerModulesOf(unresolved, [])).toContain('lib/testing/selection/surface-groups.ts');
  expect(runnerModulesOf(unresolved, [])).toContain('lib/testing/selection/coverage-map.ts');
});

test("the scripts CI runs and the planner's evidence modules are runner modules too", () => {
  const planned = new Map([
    ...graph,
    ['scripts/ci-plan.ts', ['lib/testing/evidence/group-evidence.ts', 'lib/testing/lab-steps.ts']],
    ['scripts/switch-env.ts', ['lib/testing/local-stack/env-files.ts', 'lib/env/schema.ts']],
  ]);
  const modules = runnerModulesOf(planned, ['scripts/switch-env.ts']);
  expect(modules).toContain('scripts/switch-env.ts');
  expect(modules).toContain('lib/testing/local-stack/env-files.ts');
  expect(modules).toContain('lib/testing/evidence/group-evidence.ts');
  // A script a runner script imports is runner code too (the preflight's realtime parity check).
  const preflight = new Map([
    ...planned,
    ['scripts/playwright-preflight.ts', ['scripts/check-realtime-parity.ts']],
  ]);
  expect(runnerModulesOf(preflight, [])).toContain('scripts/check-realtime-parity.ts');
  // Product code and the planner's other imports stay out.
  expect(modules).not.toContain('lib/env/schema.ts');
  expect(modules).not.toContain('lib/testing/lab-steps.ts');
});

test('the scripts CI runs are those its workflow and actions name, directly or through package scripts', () => {
  const scripts = {
    'env:local': 'bun scripts/switch-env.ts local',
    check: 'bun run env:local && bun run lint',
    lint: 'bun scripts/lint.ts',
  };
  expect(
    scriptsCiRuns(
      ['run: bun run check', 'run: bun scripts/verify.ts run', '# see .github/scripts/ci-queue.ts'],
      scripts,
    ),
  ).toEqual(['scripts/lint.ts', 'scripts/switch-env.ts', 'scripts/verify.ts']);
  expect(scriptsCiRuns(["[process.execPath, ['run', 'lint']]"], scripts)).toEqual(['scripts/lint.ts']);
  // `bun install` runs the install lifecycle scripts, and every script they reach.
  expect(
    scriptsCiRuns(['run: bun install --frozen-lockfile'], {
      ...scripts,
      preinstall: 'bun scripts/pre.ts',
      postinstall: 'bun scripts/post.ts && bun run check',
    }),
  ).toEqual(['scripts/lint.ts', 'scripts/post.ts', 'scripts/pre.ts', 'scripts/switch-env.ts']);
  // The real workflow's stack setup runs the environment switch through `bun run env:local`.
  const read = (path: string): string => readFileSync(join(repositoryRoot, path), 'utf8');
  const packageScripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(read('package.json'))).scripts;
  const real = scriptsCiRuns(
    [
      read(`${workflowsFolder()}/ci.yml`),
      ...readdirSync(join(repositoryRoot, '.github/actions')).map((action) =>
        read(`.github/actions/${action}/action.yml`),
      ),
      ...CI_JOB_BODIES.map(read),
    ],
    packageScripts,
  );
  expect(real).toContain('scripts/switch-env.ts');
  // The SQL job body runs the demo seeder directly and the types check through its package script.
  expect(real).toContain('scripts/seed-demo-data.ts');
  expect(real).toContain('scripts/generate-supabase-types.ts');
  // The setup action's `bun install` runs the postinstall scripts.
  expect(real).toContain('scripts/fetch-wholesaler-reader.ts');
  expect(real).toContain('scripts/stamp-dependencies.ts');
});

const REGISTRY = 'lib/testing/selection/test-groups.ts';
const registry = (rows: string, timing: string, extra = ''): string => `// The registry.
const sqlDefinitions: readonly string[] = [${rows}];
function declaredTiming(files: readonly string[]): boolean {
  return files.some((file) => file === ${timing});
}${extra}
`;

test("a registry change inside its rows plans by diff, and one in the runner's logic runs every group", () => {
  const before = registry("'offers'", "'a.spec.ts'");
  expect(changesOnlyRows(REGISTRY, before, registry("'offers', 'equipment'", "'a.spec.ts'"))).toBe(true);
  expect(changesOnlyRows(REGISTRY, before, before.replace('// The registry.', '// Rows.'))).toBe(true);
  expect(changesOnlyRows(REGISTRY, before, registry("'offers'", "'b.spec.ts'"))).toBe(false);
  expect(changesOnlyRows(REGISTRY, before, registry("'offers'", "'a.spec.ts'", '\nconst more = 1;'))).toBe(
    false,
  );
  expect(
    changesOnlyRows(REGISTRY, before, before.replace('readonly string[] =', 'readonly number[] =')),
  ).toBe(false);
  expect(changesOnlyRows('lib/testing/runner/app-port.ts', before, registry("'x'", "'a.spec.ts'"))).toBe(
    false,
  );

  const changedFiles = [REGISTRY, 'lib/inventory/stock.ts'];
  const rows = planFor(changedFiles, { rowChanges: [REGISTRY] });
  expect(rows.fullReason).toBeUndefined();
  expect(ids(rows)).toEqual(['golden:gg-00', 'audit:wave-2:p1-13']);
  const logic = planFor(changedFiles);
  expect([logic.fullReason, logic.tooling.browser]).toEqual([
    undefined,
    `Tooling input changed: ${REGISTRY}`,
  ]);
});

test('every registry row declaration names a top-level declaration of its module', () => {
  const root = resolve(import.meta.dir, '../../..');
  for (const [file, names] of Object.entries(REGISTRY_ROWS)) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const name of names) expect(source).toMatch(new RegExp(`^(export )?const ${name}\\b`, 'm'));
  }
});

test('files that cannot change how every group installs, builds or runs plan by diff', () => {
  for (const file of [
    'lib/testing/selection/surface-groups.ts',
    'lib/testing/selection/coverage-map.ts',
    '.github/pull_request_template.md',
    '.github/scripts/health-check.sh',
    '.github/workflows/release.yml',
    '.github/workflows/nightly.yml',
    'vercel.json',
    'lib/testing/runner/delete-after-cd.test.ts',
    'lib/testing/selection/coverage-map.json',
  ]) {
    const plan = planFor([file]);
    expect([file, plan.fullReason, ids(plan)]).toEqual([file, undefined, []]);
  }
});

test('visual and layout groups run in a pull request only when their own test code changed, lab groups also on product code', () => {
  const sweeps = [
    ...groups,
    group(
      'audit:layout:work',
      'tests/audit/layout/surfaces-work.spec.ts',
      ['work', 'customers'],
      'release-only',
    ),
    group('audit:lab:office', 'tests/audit/lab/office.spec.ts', ['work', 'planning'], 'product'),
  ];
  const plan = (changedFiles: string[]): string[] => ids(planFor(changedFiles, { groups: sweeps }));
  // A work page selects the work journey and the lab group, never the work sweep that shares its scope.
  expect(plan(['app/(app)/auftraege/page.tsx', 'components/ui/button.tsx', 'app/globals.css'])).toEqual([
    'golden:gg-00',
    'audit:wave-2:p1-13',
    'audit:lab:office',
  ]);
  expect(plan(['docs/technical/performance.md'])).toEqual([]);
  for (const spec of [
    'tests/audit/visual/references.spec.ts',
    'tests/audit/visual/acceptance-sets.spec.ts',
    'tests/audit/layout/surfaces-work.spec.ts',
    'tests/audit/lab/office.spec.ts',
  ])
    expect(plan([spec])).toEqual(
      sweeps.filter((entry) => entry.files.includes(spec)).map((entry) => entry.id),
    );
  expect(plan(['tests/audit/performance/calendar.spec.ts'])).toEqual([]);
  expect(ids(planFor([], { groups: sweeps, fullRun: 'Nightly run' }))).toEqual([
    ...EVERY_BROWSER_GROUP,
    'audit:layout:work',
    'audit:lab:office',
    'audit:performance:calendar',
  ]);
});

test('the visual groups share shards of their own, the other groups always keep one, and both stay within the budget', () => {
  const plan = planFor(undefined);
  expect(plan.shards).toEqual([
    { shard: 1, groups: 'audit:visual,audit:visual:acceptance:sets' },
    { shard: 2, groups: 'golden:gg-00,golden:p1-04,audit:wave-2:p1-13' },
  ]);
  const crowded = Array.from({ length: 100 }, (_, index) =>
    group(`audit:visual:set-${index}`, `tests/audit/visual/set-${index}.spec.ts`, ['*']),
  );
  const shards = planFor(undefined, {
    groups: [...crowded, group('golden:gg-00', 'tests/golden/gg-00.spec.ts', ['*'])],
    durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS / 10 },
  }).shards;
  expect(shards).toHaveLength(MAX_SHARDS);
  expect(shards.at(-1)?.groups).toBe('golden:gg-00');
  expect(shards.flatMap((shard) => shard.groups.split(','))).toHaveLength(crowded.length + 1);
});

test('a full run of the registered groups fills the job budget by their recorded durations, the visual groups in shards of their own', () => {
  const registered = getTestGroups(repositoryRoot).map((entry) => ({
    ...entry,
    executionInputs: entry.files,
    trigger: entry.changeTrigger,
  }));
  const recorded = readGroupDurations(repositoryRoot);
  const { browser, shards } = planFor([], {
    groups: registered,
    fullRun: 'Nightly run',
    durations: recorded,
  });
  expect(shards).toHaveLength(MAX_SHARDS);
  const packed = shards.map((shard) => shard.groups.split(','));
  expect(packed.flat().sort()).toEqual(browser.map((entry) => entry.id).sort());
  const visual = packed.filter((ids) => ids.some((id) => id.startsWith('audit:visual')));
  expect(visual.every((ids) => ids.every((id) => id.startsWith('audit:visual')))).toBe(true);
  expect(packed.slice(0, visual.length)).toEqual(visual);
  // Each pool packs evenly: no shard of the others holds more than its fair share plus one group.
  const seconds = (ids: string[]): number =>
    ids.reduce((sum, id) => sum + (recorded.groups[id] ?? recorded.defaultSeconds), 0);
  const others = packed.slice(visual.length);
  const longest = Math.max(...others.flat().map((id) => seconds([id])));
  for (const ids of others)
    expect(seconds(ids)).toBeLessThanOrEqual(seconds(others.flat()) / others.length + longest);
});

test('a capped plan takes the split of the shards whose longest shard is shortest, among every feasible split', () => {
  const visual = Array.from({ length: 5 }, (_, index) =>
    group(`audit:visual:set-${index}`, `tests/audit/visual/set-${index}.spec.ts`, ['*']),
  );
  const others = Array.from({ length: 9 }, (_, index) =>
    group(`audit:other:${index}`, `tests/audit/other/${index}.spec.ts`, ['*']),
  );
  const recorded: GroupDurations = {
    source: 'test',
    defaultSeconds: 450,
    groups: Object.fromEntries(visual.map((entry) => [entry.id, 700])),
  };
  const { shards } = planFor(undefined, { groups: [...visual, ...others], durations: recorded });
  expect(shards).toHaveLength(MAX_SHARDS);
  const load = (ids: string): number =>
    ids.split(',').reduce((sum, id) => sum + (recorded.groups[id] ?? recorded.defaultSeconds), 0);
  // Five visual shards of 700 s and three of 1,350 s beat four and four (1,400 s).
  expect(Math.max(...shards.map((shard) => load(shard.groups)))).toBe(1350);
});

test('shards hold every selected group once and never exceed the job budget', () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    group(`audit:many:${index}`, `tests/audit/many/${index}.spec.ts`, ['*']),
  );
  const plan = planFor(undefined, {
    groups: many,
    durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS / 10 },
  });
  expect(plan.shards).toHaveLength(MAX_SHARDS);
  const dealt = plan.shards.flatMap((shard) => shard.groups.split(','));
  expect(dealt.sort()).toEqual(many.map((entry) => entry.id).sort());
  const one = planFor(['lib/inventory/stock.ts']);
  expect(one.shards).toEqual([{ shard: 1, groups: 'golden:gg-00,audit:wave-2:p1-13' }]);
});

test('a selection takes as few shards as hold its recorded seconds at the target, and an unknown group counts the default', () => {
  const planned = (seconds: Record<string, number>, defaultSeconds = 60): string[][] =>
    planFor(undefined, { durations: { source: 'test', defaultSeconds, groups: seconds } })
      .shards.filter((shard) => !shard.groups.startsWith('audit:visual'))
      .map((shard) => shard.groups.split(','));
  const target = TARGET_SHARD_SECONDS;
  expect(planned({ 'golden:gg-00': target / 3, 'golden:p1-04': target / 3 })).toHaveLength(1);
  expect(planned({ 'golden:gg-00': target, 'golden:p1-04': target / 2 })).toEqual([
    ['golden:gg-00'],
    ['golden:p1-04', 'audit:wave-2:p1-13'],
  ]);
  expect(planned({}, target)).toHaveLength(3);
});

test('a pool never takes more shards than it has groups, so no shard is empty', () => {
  const plan = planFor(undefined, { durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS * 3 } });
  expect(plan.shards).toHaveLength(EVERY_BROWSER_GROUP.length);
  expect(plan.shards.every((shard) => shard.groups.length > 0)).toBe(true);
  // Zero-second groups go to the shard with fewer groups, never all into one.
  const zero = ciPlan({
    groups,
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations: {
      source: 'test',
      defaultSeconds: 60,
      groups: { 'golden:gg-00': 1900, 'golden:p1-04': 0, 'audit:wave-2:p1-13': 0 },
    },
    rowChanges: [],
    dependencies: {},
    actionJobs: {},
  });
  expect(zero.shards.filter((shard) => !shard.groups.startsWith('audit:visual'))).toEqual([
    { shard: 2, groups: 'golden:gg-00' },
    { shard: 3, groups: 'audit:wave-2:p1-13' },
    { shard: 4, groups: 'golden:p1-04' },
  ]);
  const long: GroupDurations = { source: 'test', defaultSeconds: TARGET_SHARD_SECONDS * 3, groups: {} };
  expect(componentShards(['ui:contracts:work'], long)).toEqual([{ shard: 1, groups: 'ui:contracts:work' }]);
});

test('packing puts the longest group first onto the lightest shard, and packs a selection alike in any order', () => {
  const seconds = { a: 500, b: 400, c: 300, d: 300, e: 200, f: 100 };
  const ids = Object.keys(seconds);
  const recorded: GroupDurations = { source: 'test', defaultSeconds: 60, groups: seconds };
  const shards = componentShards(ids, recorded);
  // 1,800 s fill two jobs. a → 1 (500), b → 2 (400), c → 2 (700), d → 1 (800), e → 2 (900), f → 1 (900).
  expect(shards).toEqual([
    { shard: 1, groups: 'a,d,f' },
    { shard: 2, groups: 'b,c,e' },
  ]);
  const membership = (packed: { groups: string }[]): string[][] =>
    packed.map((shard) => shard.groups.split(',').sort());
  expect(membership(componentShards([...ids].reverse(), recorded))).toEqual(membership(shards));
  expect(componentShards(ids, recorded)).toEqual(shards);
});

test('the component areas of a full set run in at most two jobs, a short selection in one', () => {
  const recorded = readGroupDurations(repositoryRoot);
  const areas = getTestGroups(repositoryRoot)
    .filter((entry) => entry.kind === 'ui')
    .map((entry) => entry.id);
  const full = componentShards(areas, recorded);
  // The recorded durations are refreshed, so they may fit one job or need both.
  expect(full.length).toBeGreaterThanOrEqual(1);
  expect(full.length).toBeLessThanOrEqual(2);
  expect(full.flatMap((shard) => shard.groups.split(',')).sort()).toEqual([...areas].sort());
  expect(componentShards(['ui:contracts:customers'], recorded)).toEqual([
    { shard: 1, groups: 'ui:contracts:customers' },
  ]);
  expect(componentShards([], recorded)).toEqual([]);
});

test('component areas take a second job exactly when their seconds pass one job, and never a third', () => {
  const recorded = (seconds: number): GroupDurations => ({
    source: 'test',
    defaultSeconds: seconds,
    groups: {},
  });
  const areas = ['ui:contracts:a', 'ui:contracts:b', 'ui:contracts:c', 'ui:contracts:d'];
  // 4 × 120 s fill one 8-minute job exactly; 4 × 121 s need a second; 4 × 600 s stay at two.
  expect(componentShards(areas, recorded(120))).toHaveLength(1);
  expect(componentShards(areas, recorded(121))).toHaveLength(2);
  expect(componentShards(areas, recorded(600))).toHaveLength(2);
});

test('when the shard budget binds, the visual and other shards split it by the shortest longest shard', () => {
  const visual = ['1', '2', '3'].map((index) =>
    group(`audit:visual:v${index}`, `tests/audit/visual/v${index}.spec.ts`, ['*'], 'release-only'),
  );
  const others = Array.from({ length: 18 }, (_, index) =>
    group(`audit:other:${index}`, `tests/audit/other/${index}.spec.ts`, ['*']),
  );
  const seconds = Object.fromEntries([
    ...visual.map((entry) => [entry.id, 900] as const),
    ...others.map((entry) => [entry.id, 700] as const),
  ]);
  const { shards } = planFor(undefined, {
    groups: [...visual, ...others],
    durations: { source: 'test', defaultSeconds: 60, groups: seconds },
  });
  const packed = shards.map((shard) => shard.groups.split(','));
  // The targets want 3 visual and 14 other shards. 3 + 5 would load an other shard with 2,800 s.
  expect(packed.filter((ids) => ids[0]?.startsWith('audit:visual'))).toHaveLength(2);
  expect(packed.filter((ids) => !ids[0]?.startsWith('audit:visual'))).toHaveLength(6);
  const load = (ids: string[]): number => ids.reduce((sum, id) => sum + (seconds[id] ?? 0), 0);
  expect(Math.max(...packed.map(load))).toBe(2100);
  expect(packed.flat().sort()).toEqual([...visual, ...others].map((entry) => entry.id).sort());
});

test('the planner log prints every reason and file name as one JSON string, so a path cannot forge a line or a workflow command', () => {
  const forged = 'app/x\n::error::forged.tsx';
  const lines = planLog(
    {
      fullReason: `Tooling input changed: ${forged}`,
      browser: [{ id: `golden:${forged}`, reason: `own test (${forged})` }],
      shards: [{ shard: 1, groups: `golden:${forged}` }],
      tooling: { everyGroup: undefined, browser: undefined, fast: {}, invoices: undefined, lintOnly: [] },
    },
    { [`ui:${forged}`]: `Tailwind scans ${forged}\r::warning::also` },
    `The renderer, the invoice core or their dependencies changed (${forged})`,
  );
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(line.trimStart().startsWith('::')).toBe(false);
  }
  expect(lines.join('\n')).toContain(JSON.stringify(`own test (${forged})`));
  expect(lines.at(-1)).toContain(
    `E-invoices: ${JSON.stringify(`The renderer, the invoice core or their dependencies changed (${forged})`)}`,
  );
});

test('support only a wall-clock group imports still runs the critical journeys, never the wall-clock group', () => {
  const measured = {
    ...group(
      'audit:performance:calendar',
      'tests/audit/performance/calendar.spec.ts',
      ['planning'],
      'release-only',
    ),
    executionInputs: ['tests/audit/performance/calendar.spec.ts', 'tests/audit/support/calendar-live.ts'],
  };
  const plan = planFor(['tests/audit/support/calendar-live.ts'], {
    groups: [...groups.filter((entry) => entry.id !== measured.id), measured],
  });
  expect(ids(plan)).toEqual(['golden:gg-00']);
});

test('the critical journeys and both lab groups of a product change share one shard by their recorded durations, which pays one setup', () => {
  const critical = Object.keys(CRITICAL_JOURNEYS).map((id) =>
    group(id, `tests/golden/${id.replace('golden:', '')}.spec.ts`, ['*'], 'critical'),
  );
  const labs = ['field', 'office'].map((name) =>
    group(`audit:lab:${name}`, `tests/audit/lab/${name}.spec.ts`, ['*'], 'product'),
  );
  const plan = planFor(['lib/jobs/actions.ts'], {
    groups: [...critical, ...labs],
    durations: readGroupDurations(repositoryRoot),
  });
  expect(plan.browser.map((entry) => entry.id)).toEqual([
    ...Object.keys(CRITICAL_JOURNEYS),
    'audit:lab:field',
    'audit:lab:office',
  ]);
  expect(plan.shards.map((shard) => shard.groups.split(',').length)).toEqual([11]);
});

// A hosted runner has no reviewed wall-clock baseline, so a timed shard fails its wall-clock group on
// "no reviewed baseline" whatever its steps do. Every job that runs the plan's shards runs them untimed.
test("every workflow runs the plan's browser shards untimed", () => {
  const workflows = resolve(import.meta.dir, '../../..', workflowsFolder());
  const shardRuns = readdirSync(workflows).flatMap((file) => {
    const lines = readFileSync(join(workflows, file), 'utf8').split('\n');
    // A shard's groups reach its step as `matrix.groups`, directly or through an env variable.
    const aliases = lines.flatMap(
      (line) => /^\s*([A-Z_]+): \$\{\{ matrix\.groups \}\}/.exec(line)?.[1] ?? [],
    );
    return lines
      .filter(
        (line) =>
          line.includes('scripts/verify.ts run') &&
          (line.includes('matrix.groups') ||
            aliases.some((alias) => new RegExp(`\\$\\{?${alias}\\b`).test(line))),
      )
      .map((line) => ({ file, untimed: line.includes('--untimed') }));
  });
  // ci.yml runs its shards through scripts/ci/job.ts browser (lib/testing/ci/dag.test.ts).
  expect([...new Set(shardRuns.map((run) => run.file))].sort()).toEqual(['date-lookahead.yml']);
  expect(shardRuns.filter((run) => !run.untimed)).toEqual([]);
});
