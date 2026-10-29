// CI runs the browser groups a change can break, and everything when it cannot tell.
import { expect, test } from 'bun:test';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { ciPlan, MAX_SHARDS, runnerModules as runnerModulesOf, type CiGroup } from './ci-plan';
import { CRITICAL_JOURNEYS, type ChangeTrigger } from './change-triggers';

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
  group('audit:visual:acceptance', 'tests/audit/visual/acceptance.spec.ts', ['*'], 'release-only'),
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
  'audit:visual:acceptance',
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
  const nightly = ciPlan({ groups, changedFiles: [], fullRun: 'Nightly run', runnerModules });
  expect(nightly.fullReason).toBe('Nightly run');
  expect(ids(nightly)).toEqual(EVERY_BROWSER_GROUP);
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

test('lab, visual and layout groups run in a pull request only when their own test code changed', () => {
  const sweeps = [
    ...groups,
    group(
      'audit:layout:work',
      'tests/audit/layout/surfaces-work.spec.ts',
      ['work', 'customers'],
      'release-only',
    ),
    group('audit:lab:office', 'tests/audit/lab/office.spec.ts', ['work', 'planning'], 'release-only'),
  ];
  const plan = (changedFiles: string[]): string[] =>
    ids(ciPlan({ groups: sweeps, changedFiles, fullRun: undefined, runnerModules }));
  // A work page selects the work journey, never the work sweep or lab group that share its scope.
  expect(plan(['app/(app)/auftraege/page.tsx', 'components/ui/button.tsx', 'app/globals.css'])).toEqual([
    'golden:gg-00',
    'audit:wave-2:p1-13',
  ]);
  for (const spec of [
    'tests/audit/visual/references.spec.ts',
    'tests/audit/visual/acceptance.spec.ts',
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
  ]);
});

test('each visual group runs in a shard of its own', () => {
  const plan = ciPlan({ groups, changedFiles: undefined, fullRun: undefined, runnerModules });
  expect(plan.shards.slice(0, 2)).toEqual([
    { shard: 1, groups: 'audit:visual' },
    { shard: 2, groups: 'audit:visual:acceptance' },
  ]);
  expect(plan.shards[2]?.groups).toBe('golden:gg-00,golden:p1-04,audit:wave-2:p1-13');
  const crowded = Array.from({ length: MAX_SHARDS }, (_, index) =>
    group(`audit:visual:set-${index}`, `tests/audit/visual/set-${index}.spec.ts`, ['*']),
  );
  const shards = ciPlan({
    groups: [...crowded, group('golden:gg-00', 'tests/golden/gg-00.spec.ts', ['*'])],
    changedFiles: undefined,
    fullRun: undefined,
    runnerModules,
  }).shards;
  expect(shards.flatMap((shard) => shard.groups.split(','))).toContain('golden:gg-00');
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

test('the critical journeys of a product change split into three shards', () => {
  const critical = Object.keys(CRITICAL_JOURNEYS).map((id) =>
    group(id, `tests/golden/${id.replace('golden:', '')}.spec.ts`, ['*'], 'critical'),
  );
  const plan = ciPlan({
    groups: critical,
    changedFiles: ['lib/jobs/actions.ts'],
    fullRun: undefined,
    runnerModules,
  });
  expect(plan.browser.map((entry) => entry.id)).toEqual(Object.keys(CRITICAL_JOURNEYS));
  expect(plan.shards.map((shard) => shard.groups.split(',').length)).toEqual([3, 3, 3]);
});
