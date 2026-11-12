// CI runs the browser groups a change can break, and everything when it cannot tell.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { ciPlan, MAX_SHARDS, runnerModules as runnerModulesOf, type CiGroup } from './ci-plan';
import { CRITICAL_JOURNEYS, type ChangeTrigger } from './change-triggers';
import { getTestGroups } from './test-groups';

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
const runnerModules = runnerModulesOf(graph);
const ids = (plan: ReturnType<typeof ciPlan>): string[] => plan.browser.map((entry) => entry.id);
const EVERY_BROWSER_GROUP = [
  'golden:gg-00',
  'golden:p1-04',
  'audit:wave-2:p1-13',
  'audit:visual',
  'audit:visual:acceptance:sets',
];

test('an unreadable diff and a tooling change run every browser group except the wall-clock ones', () => {
  const unreadable = ciPlan({ groups, changedFiles: undefined, fullRun: undefined, runnerModules });
  expect(unreadable.fullReason).toBe('The diff against the base could not be read');
  expect(ids(unreadable)).toEqual(EVERY_BROWSER_GROUP);
  for (const tooling of [
    'bun.lock',
    '.github/workflows/ci.yml',
    '.github/actions/setup/action.yml',
    'lib/testing/runner/app-port.ts',
    'lib/testing/selection/test-groups.ts',
  ])
    expect(ids(ciPlan({ groups, changedFiles: [tooling], fullRun: undefined, runnerModules }))).toEqual(
      EVERY_BROWSER_GROUP,
    );
});

test("the nightly run and the release gate add each wall-clock group's steps, untimed", () => {
  for (const fullRun of ['Nightly run', 'Release 0123abc']) {
    const plan = ciPlan({ groups, changedFiles: [], fullRun, runnerModules });
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
  });
  expect(plan.fullReason).toBeUndefined();
  expect(ids(plan)).toEqual(['golden:gg-00', 'audit:wave-2:p1-13']);
  expect(
    ids(ciPlan({ groups, changedFiles: ['tests/golden/p1-04.spec.ts'], fullRun: undefined, runnerModules })),
  ).toEqual(['golden:p1-04']);
  expect(
    ids(ciPlan({ groups, changedFiles: ['docs/README.md'], fullRun: undefined, runnerModules })),
  ).toEqual([]);
  expect(
    ciPlan({ groups, changedFiles: ['docs/README.md'], fullRun: undefined, runnerModules }).shards,
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
  expect(runnerModulesOf(unresolved)).toContain('lib/testing/selection/surface-groups.ts');
  expect(runnerModulesOf(unresolved)).toContain('lib/testing/selection/coverage-map.ts');
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
    const plan = ciPlan({ groups, changedFiles: [file], fullRun: undefined, runnerModules });
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
    ids(ciPlan({ groups: sweeps, changedFiles, fullRun: undefined, runnerModules }));
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
  expect(ids(ciPlan({ groups: sweeps, changedFiles: [], fullRun: 'Nightly run', runnerModules }))).toEqual([
    ...EVERY_BROWSER_GROUP,
    'audit:layout:work',
    'audit:lab:office',
    'audit:performance:calendar',
  ]);
});

test('the visual groups share shards of their own, and the other groups always keep one', () => {
  const plan = ciPlan({ groups, changedFiles: undefined, fullRun: undefined, runnerModules });
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
  }).shards;
  expect(shards.length).toBeGreaterThan(MAX_SHARDS);
  expect(shards.at(-1)?.groups).toBe('golden:gg-00');
});

test('a full run of the registered groups fills the job budget, two shards of it with the visual groups', () => {
  const registered = getTestGroups(resolve(import.meta.dir, '../../..')).map((entry) => ({
    ...entry,
    executionInputs: entry.files,
    trigger: entry.changeTrigger,
  }));
  const { shards } = ciPlan({
    groups: registered,
    changedFiles: [],
    fullRun: 'Nightly run',
    runnerModules,
  });
  expect(shards).toHaveLength(MAX_SHARDS);
  const visual = shards.filter((shard) => shard.groups.includes('audit:visual'));
  expect(visual.map((shard) => shard.shard)).toEqual([1, 2]);
  for (const shard of visual)
    expect(shard.groups.split(',').every((id) => id.startsWith('audit:visual'))).toBe(true);
});

test('shards hold every selected group once and never exceed the job budget', () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    group(`audit:many:${index}`, `tests/audit/many/${index}.spec.ts`, ['*']),
  );
  const plan = ciPlan({ groups: many, changedFiles: undefined, fullRun: undefined, runnerModules });
  expect(plan.shards).toHaveLength(MAX_SHARDS);
  const dealt = plan.shards.flatMap((shard) => shard.groups.split(','));
  expect(dealt.sort()).toEqual(many.map((entry) => entry.id).sort());
  const one = ciPlan({ groups, changedFiles: ['lib/inventory/stock.ts'], fullRun: undefined, runnerModules });
  expect(one.shards).toEqual([{ shard: 1, groups: 'golden:gg-00,audit:wave-2:p1-13' }]);
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
  });
  expect(ids(plan)).toEqual(['golden:gg-00']);
});

test('the critical journeys and both lab groups of a product change split into three shards', () => {
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
  });
  expect(plan.browser.map((entry) => entry.id)).toEqual([
    ...Object.keys(CRITICAL_JOURNEYS),
    'audit:lab:field',
    'audit:lab:office',
  ]);
  expect(plan.shards.map((shard) => shard.groups.split(',').length)).toEqual([4, 4, 3]);
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
  expect([...new Set(shardRuns.map((run) => run.file))].sort()).toEqual(['ci.yml', 'date-lookahead.yml']);
  expect(shardRuns.filter((run) => !run.untimed)).toEqual([]);
});
