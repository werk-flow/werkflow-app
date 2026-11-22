// CI runs the browser groups a change can break, and everything when it cannot tell.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import {
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
import { readGroupDurations, type GroupDurations } from './group-durations';
import { getTestGroups } from './test-groups';
import { z } from '@/lib/zod';

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
const EVERY_BROWSER_GROUP = [
  'golden:gg-00',
  'golden:p1-04',
  'audit:wave-2:p1-13',
  'audit:visual',
  'audit:visual:acceptance:sets',
];

test('an unreadable diff and a tooling change run every browser group except the wall-clock ones', () => {
  const unreadable = ciPlan({
    groups,
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
  });
  expect(unreadable.fullReason).toBe('The diff against the base could not be read');
  expect(ids(unreadable)).toEqual(EVERY_BROWSER_GROUP);
  for (const tooling of [
    'bun.lock',
    '.github/workflows/ci.yml',
    '.github/actions/setup/action.yml',
    'scripts/ci/job.ts',
    'lib/testing/ci/run-plan.ts',
    'postcss.config.mjs',
    'lib/testing/runner/app-port.ts',
    'lib/testing/selection/test-groups.ts',
  ])
    expect(
      ids(
        ciPlan({
          groups,
          changedFiles: [tooling],
          fullRun: undefined,
          runnerModules,
          durations,
          rowChanges: [],
        }),
      ),
    ).toEqual(EVERY_BROWSER_GROUP);
  // The CI logic's own unit tests are no tooling input.
  const ciTest = ['lib/testing/ci/check.test.ts'];
  expect(
    ciPlan({ groups, changedFiles: ciTest, fullRun: undefined, runnerModules, durations, rowChanges: [] })
      .fullReason,
  ).toBeUndefined();
});

test("the nightly run and the release gate add each wall-clock group's steps, untimed", () => {
  for (const fullRun of ['Nightly run', 'Release 0123abc']) {
    const plan = ciPlan({ groups, changedFiles: [], fullRun, runnerModules, durations, rowChanges: [] });
    expect(plan.fullReason).toBe(fullRun);
    expect(ids(plan)).toEqual([...EVERY_BROWSER_GROUP, 'audit:performance:calendar']);
    expect(plan.browser.at(-1)?.reason).toBe(`${fullRun}: its steps, untimed`);
    expect(plan.shards.flatMap((shard) => shard.groups.split(','))).toContain('audit:performance:calendar');
  }
});

test('a pull request or a push to main runs the critical journeys and the groups its changed files select', () => {
  const plan = ciPlan({
    groups,
    changedFiles: ['lib/inventory/stock.ts'],
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
  });
  expect(plan.fullReason).toBeUndefined();
  expect(ids(plan)).toEqual(['golden:gg-00', 'audit:wave-2:p1-13']);
  expect(
    ids(
      ciPlan({
        groups,
        changedFiles: ['tests/golden/p1-04.spec.ts'],
        fullRun: undefined,
        runnerModules,
        durations,
        rowChanges: [],
      }),
    ),
  ).toEqual(['golden:p1-04']);
  expect(
    ids(
      ciPlan({
        groups,
        changedFiles: ['docs/README.md'],
        fullRun: undefined,
        runnerModules,
        durations,
        rowChanges: [],
      }),
    ),
  ).toEqual([]);
  expect(
    ciPlan({
      groups,
      changedFiles: ['docs/README.md'],
      fullRun: undefined,
      runnerModules,
      durations,
      rowChanges: [],
    }).shards,
  ).toEqual([]);
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
      read('.github/workflows/ci.yml'),
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
  const rows = ciPlan({
    groups,
    changedFiles,
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [REGISTRY],
  });
  expect(rows.fullReason).toBeUndefined();
  expect(ids(rows)).toEqual(['golden:gg-00', 'audit:wave-2:p1-13']);
  const logic = ciPlan({
    groups,
    changedFiles,
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
  });
  expect(logic.fullReason).toBe(`Tooling input changed: ${REGISTRY}`);
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
    const plan = ciPlan({
      groups,
      changedFiles: [file],
      fullRun: undefined,
      runnerModules,
      durations,
      rowChanges: [],
    });
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
  const plan = (changedFiles: string[]): string[] =>
    ids(
      ciPlan({ groups: sweeps, changedFiles, fullRun: undefined, runnerModules, durations, rowChanges: [] }),
    );
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
  expect(
    ids(
      ciPlan({
        groups: sweeps,
        changedFiles: [],
        fullRun: 'Nightly run',
        runnerModules,
        durations,
        rowChanges: [],
      }),
    ),
  ).toEqual([...EVERY_BROWSER_GROUP, 'audit:layout:work', 'audit:lab:office', 'audit:performance:calendar']);
});

test('the visual groups share shards of their own, the other groups always keep one, and both stay within the budget', () => {
  const plan = ciPlan({
    groups,
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
  });
  expect(plan.shards).toEqual([
    { shard: 1, groups: 'audit:visual,audit:visual:acceptance:sets' },
    { shard: 2, groups: 'golden:gg-00,golden:p1-04,audit:wave-2:p1-13' },
  ]);
  const crowded = Array.from({ length: 100 }, (_, index) =>
    group(`audit:visual:set-${index}`, `tests/audit/visual/set-${index}.spec.ts`, ['*']),
  );
  const shards = ciPlan({
    groups: [...crowded, group('golden:gg-00', 'tests/golden/gg-00.spec.ts', ['*'])],
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS / 10 },
    rowChanges: [],
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
  const { browser, shards } = ciPlan({
    groups: registered,
    changedFiles: [],
    fullRun: 'Nightly run',
    runnerModules,
    durations: recorded,
    rowChanges: [],
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

test('shards hold every selected group once and never exceed the job budget', () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    group(`audit:many:${index}`, `tests/audit/many/${index}.spec.ts`, ['*']),
  );
  const plan = ciPlan({
    groups: many,
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS / 10 },
    rowChanges: [],
  });
  expect(plan.shards).toHaveLength(MAX_SHARDS);
  const dealt = plan.shards.flatMap((shard) => shard.groups.split(','));
  expect(dealt.sort()).toEqual(many.map((entry) => entry.id).sort());
  const one = ciPlan({
    groups,
    changedFiles: ['lib/inventory/stock.ts'],
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
  });
  expect(one.shards).toEqual([{ shard: 1, groups: 'golden:gg-00,audit:wave-2:p1-13' }]);
});

test('a selection takes as few shards as hold its recorded seconds at the target, and an unknown group counts the default', () => {
  const planned = (seconds: Record<string, number>, defaultSeconds = 60): string[][] =>
    ciPlan({
      groups,
      changedFiles: undefined,
      fullRun: undefined,
      runnerModules,
      durations: { source: 'test', defaultSeconds, groups: seconds },
      rowChanges: [],
    })
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
  const plan = ciPlan({
    groups,
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations: { ...durations, defaultSeconds: TARGET_SHARD_SECONDS * 3 },
    rowChanges: [],
  });
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
  const { shards } = ciPlan({
    groups: [...visual, ...others],
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
    durations: { source: 'test', defaultSeconds: 60, groups: seconds },
    rowChanges: [],
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
      browser: [{ id: 'golden:gg-00', reason: `own test (${forged})` }],
      shards: [{ shard: 1, groups: 'golden:gg-00' }],
    },
    { 'ui:contracts:work': `Tailwind scans ${forged}\r::warning::also` },
  );
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(line.trimStart().startsWith('::')).toBe(false);
  }
  expect(lines.join('\n')).toContain(JSON.stringify(`own test (${forged})`));
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
  const plan = ciPlan({
    groups: [...groups.filter((entry) => entry.id !== measured.id), measured],
    changedFiles: ['tests/audit/support/calendar-live.ts'],
    fullRun: undefined,
    runnerModules,
    durations,
    rowChanges: [],
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
  const plan = ciPlan({
    groups: [...critical, ...labs],
    changedFiles: ['lib/jobs/actions.ts'],
    fullRun: undefined,
    runnerModules,
    durations: readGroupDurations(repositoryRoot),
    rowChanges: [],
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
  const workflows = resolve(import.meta.dir, '../../../.github/workflows');
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
