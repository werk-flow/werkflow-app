// Which jobs a run executes: the fast tier for a PR, browser shards once in the integration run,
// nothing for a push whose tree already passed, and reuse only where a receipt stands
// (lib/testing/ci/run-plan.ts).
import { expect, test } from 'bun:test';
import type { CiEvent } from './dag';
import type { ReuseKey } from './reuse';
import { jobShards, midnightNotice, plannedGroups, planRun } from './run-plan';

const TREE = 'a'.repeat(40);
const SHARDS = [
  { shard: 1, groups: 'audit:visual:one,audit:visual:two' },
  { shard: 2, groups: 'golden:p1-01,audit:lab:calendar' },
];
const COMPONENT_SHARDS = [
  { shard: 1, groups: 'ui:contracts:work' },
  { shard: 2, groups: 'ui:contracts:reports,ui:contracts:shell' },
];
const OUTPUTS = {
  browser: 'true',
  full: 'false',
  full_reason: '',
  shards: JSON.stringify(SHARDS),
  midnight_until: '',
  static: 'static:typecheck,static:docs,static:coverage',
  sql: 'sql:grants,sql:history,sql:triggers',
  selected_lint: 'static:lint',
  selected_static: 'static:typecheck,static:docs',
  selected_unit: 'unit:all',
  selected_sql: 'sql:grants,sql:history',
  selected_components: 'ui:contracts:work,ui:contracts:reports,ui:contracts:shell',
  component_shards: JSON.stringify(COMPONENT_SHARDS),
};
const nothingReused = (): undefined => undefined;

const plan = (
  event: CiEvent,
  options: {
    outputs?: Record<string, string>;
    passedTree?: string;
    reused?: (key: ReuseKey) => string | undefined;
  } = {},
) =>
  planRun({
    event,
    tree: TREE,
    listGrowthApproved: false,
    outputs: options.outputs ?? OUTPUTS,
    passedTree: options.passedTree,
    reused: options.reused ?? nothingReused,
  });

test("a pull request's run plans no browser shard and no midnight wait, and says why", () => {
  const pr = plan('pr', { outputs: { ...OUTPUTS, midnight_until: '2026-11-20T23:10:00.000Z' } });
  expect(pr.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'check']);
  expect(pr.shards).toEqual([]);
  expect(pr.outputs).toMatchObject({ browser: 'false', shards: '[]', midnight_until: '' });
  expect(pr.skips.browser).toContain('owner decision D1');
  expect(pr.skips.midnight).toContain('owner decision D1');
});

test('the integration, main and full runs run the selected shards and the midnight hold', () => {
  for (const event of ['integration', 'main', 'full'] as const) {
    const run = plan(event, { outputs: { ...OUTPUTS, midnight_until: '2026-11-20T23:10:00.000Z' } });
    expect(run.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'midnight', 'browser', 'check']);
    expect(run.shards).toEqual(SHARDS);
  }
  const daytime = plan('integration');
  expect(daytime.jobs).not.toContain('midnight');
  expect(daytime.skips.midnight).toBe('No browser shard waits for the midnight start window.');
});

test('the midnight notice comes from the final plan: only while a browser shard left to run waits', () => {
  const holding = { ...OUTPUTS, midnight_until: '2026-11-20T23:10:00.000Z' };
  const waits = midnightNotice(plan('integration', { outputs: holding }), false);
  expect(waits).toContain('the browser shards start at 2026-11-20T23:10:00.000Z');
  expect(waits).not.toContain('proof run');
  expect(midnightNotice(plan('integration', { outputs: holding }), true)).toContain('(proof run)');
  const oneReused = plan('integration', {
    outputs: holding,
    reused: (key) => (key.job === 'browser' && key.shard === 1 ? 'https://ci.example/runs/4' : undefined),
  });
  expect(midnightNotice(oneReused, false)).toBe(waits);
  const allReused = plan('integration', {
    outputs: holding,
    reused: (key) => (key.job === 'browser' ? 'https://ci.example/runs/4' : undefined),
  });
  expect(midnightNotice(allReused, false)).toBeUndefined();
  expect(midnightNotice(plan('pr', { outputs: holding }), false)).toBeUndefined();
  expect(midnightNotice(plan('integration'), false)).toBeUndefined();
});

test('an empty browser selection skips the shards with the reason', () => {
  const empty = plan('integration', { outputs: { ...OUTPUTS, browser: 'false', shards: '[]' } });
  expect(empty.jobs).not.toContain('browser');
  expect(empty.skips.browser).toBe('The plan selects no browser group.');
});

test('a push to main whose tree an integration run passed runs no job and cites that run', () => {
  const pushed = plan('main', { passedTree: 'https://ci.example/runs/7' });
  expect(pushed.jobs).toEqual(['plan', 'check']);
  // Every planner key stays, empty, so a reader of the outputs finds each one.
  expect(Object.keys(pushed.outputs).sort()).toEqual([
    'browser',
    'component_shards',
    'full',
    'full_reason',
    'midnight_until',
    'selected_components',
    'selected_lint',
    'selected_sql',
    'selected_static',
    'selected_unit',
    'shards',
    'sql',
    'static',
  ]);
  for (const job of ['fast', 'sql', 'components', 'midnight', 'browser'] as const)
    expect(pushed.skips[job]).toBe('The integration run https://ci.example/runs/7 passed this exact tree.');
  // An empty run URL names no run: the push runs its jobs.
  expect(plan('main', { passedTree: '' }).jobs).toContain('fast');
  // Only a push reuses a whole run: a queue run of the same tree still runs.
  expect(plan('integration', { passedTree: 'https://ci.example/runs/7' }).jobs).toContain('browser');
});

test('a reused job and a reused shard do not run; the key carries the steps and the approval', () => {
  const keys: ReuseKey[] = [];
  const run = plan('integration', {
    reused: (key) => {
      keys.push(key);
      return key.job === 'sql' ||
        key.groups.includes('golden:p1-01') ||
        key.groups.includes('ui:contracts:work')
        ? 'https://ci.example/runs/3'
        : undefined;
    },
  });
  expect(run.jobs).toEqual(['plan', 'fast', 'components', 'browser', 'check']);
  expect(run.skips.sql).toContain('https://ci.example/runs/3');
  expect(run.shards).toEqual(SHARDS.slice(0, 1));
  expect(keys).toContainEqual({
    job: 'sql',
    shard: null,
    tree: TREE,
    groups: ['sql:grants', 'sql:history', 'step:types', 'step:seed'],
    listGrowthApproved: false,
  });
  expect(run.outputs.component_shards).toBe(JSON.stringify(COMPONENT_SHARDS.slice(1)));
  expect(keys).toContainEqual({
    job: 'components',
    shard: 2,
    tree: TREE,
    groups: ['ui:contracts:reports', 'ui:contracts:shell'],
    listGrowthApproved: false,
  });
  expect(keys.some((key) => key.job === 'fast')).toBe(false);
  // A shard's key carries its number, so a receipt of shard 2 never stands for shard 1.
  expect(keys.filter((key) => key.job === 'browser').map((key) => key.shard)).toEqual([1, 2]);
});

test('every shard reused skips the browser job and its midnight hold', () => {
  const run = plan('integration', {
    outputs: { ...OUTPUTS, midnight_until: '2026-11-20T23:10:00.000Z' },
    reused: (key) => (key.job === 'browser' ? 'https://ci.example/runs/4' : undefined),
  });
  expect(run.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'check']);
  expect(run.skips.browser).toContain('shard 1 by https://ci.example/runs/4');
  expect(run.outputs.midnight_until).toBe('');
});

test('a planner answer without a required key plans nothing, so no gate goes missing as an empty selection', () => {
  for (const key of [
    'static',
    'sql',
    'shards',
    'selected_lint',
    'selected_static',
    'selected_unit',
    'selected_sql',
    'selected_components',
    'component_shards',
  ] as const) {
    const partial = Object.fromEntries(Object.entries(OUTPUTS).filter(([name]) => name !== key));
    expect(() => plan('integration', { outputs: partial })).toThrow(`The planner gave no ${key}`);
  }
});

test('shards that do not hold each selected group exactly once, under unique numbers, plan nothing', () => {
  const broken: [string, Record<string, string>][] = [
    ['selected components without a shard', { component_shards: '[]' }],
    ['a selected component in no shard', { component_shards: JSON.stringify(COMPONENT_SHARDS.slice(0, 1)) }],
    [
      'a component group in two shards',
      {
        component_shards: JSON.stringify([...COMPONENT_SHARDS, { shard: 3, groups: 'ui:contracts:work' }]),
      },
    ],
    [
      'a component shard number twice',
      { component_shards: JSON.stringify(COMPONENT_SHARDS.map((entry) => ({ ...entry, shard: 1 }))) },
    ],
    ['a component shard of no selected group', { selected_components: 'ui:contracts:work' }],
    [
      'a component shard numbered 0',
      { component_shards: JSON.stringify([{ ...COMPONENT_SHARDS[0], shard: 0 }, COMPONENT_SHARDS[1]]) },
    ],
    [
      'a component shard of no group',
      { component_shards: JSON.stringify([...COMPONENT_SHARDS, { shard: 3, groups: '' }]) },
    ],
    ['a browser selection without a shard', { shards: '[]' }],
    ['browser shards without a browser selection', { browser: 'false' }],
    [
      'a browser group in two shards',
      { shards: JSON.stringify([...SHARDS, { shard: 3, groups: 'golden:p1-01' }]) },
    ],
    ['a browser shard numbered 1.5', { shards: JSON.stringify([{ ...SHARDS[0], shard: 1.5 }, SHARDS[1]]) }],
    ['a browser shard of no group', { shards: JSON.stringify([...SHARDS, { shard: 3, groups: '' }]) }],
    [
      'a browser shard number twice',
      { shards: JSON.stringify(SHARDS.map((entry) => ({ ...entry, shard: 2 }))) },
    ],
  ];
  // Checked before reuse: a shard that every receipt stands for still has to hold its groups.
  const reusedAll = (): string => 'https://ci.example/runs/6';
  for (const [name, changed] of broken) {
    let refused = false;
    try {
      plan('pr', { outputs: { ...OUTPUTS, ...changed }, reused: reusedAll });
    } catch {
      refused = true;
    }
    expect([name, refused]).toEqual([name, true]);
  }
});

test("Fast runs exactly the plan's selected lint, static gates and unit groups, then the build", () => {
  expect(plannedGroups('fast', OUTPUTS)).toEqual([
    'static:lint',
    'static:typecheck',
    'static:docs',
    'unit:all',
    'step:build',
  ]);
});

test("SQL runs the selected SQL groups and its steps, and an empty selection skips it with the plan's reason", () => {
  expect(plannedGroups('sql', OUTPUTS)).toEqual(['sql:grants', 'sql:history', 'step:types', 'step:seed']);
  const none = plan('pr', { outputs: { ...OUTPUTS, selected_sql: '' } });
  expect(none.jobs).toEqual(['plan', 'fast', 'components', 'check']);
  expect(none.skips.sql).toContain('selects no SQL group');
});

test('Components runs one job per component shard of the plan, and an empty selection skips it with the reason', () => {
  const run = plan('pr');
  expect(run.jobs).toContain('components');
  expect(jobShards('components', run)).toEqual(COMPONENT_SHARDS);
  expect(plannedGroups('components', OUTPUTS, COMPONENT_SHARDS[1]?.groups)).toEqual([
    'ui:contracts:reports',
    'ui:contracts:shell',
  ]);
  const none = plan('pr', { outputs: { ...OUTPUTS, selected_components: '', component_shards: '[]' } });
  expect(none.jobs).toEqual(['plan', 'fast', 'sql', 'check']);
  expect(none.skips.components).toContain('selects no component area');
  const reused = plan('pr', {
    reused: (key) => (key.job === 'components' ? 'https://ci.example/runs/5' : undefined),
  });
  expect(reused.jobs).not.toContain('components');
  expect(reused.skips.components).toContain('shard 2 by https://ci.example/runs/5');
});

test('a docs-only plan keeps the static gates #567 selects for documentation, Lint and the unit suite in Fast', () => {
  const docs = {
    ...OUTPUTS,
    selected_static: 'static:docs,static:coverage,static:dependencies',
    selected_sql: '',
    selected_components: '',
    component_shards: '[]',
  };
  const run = plan('pr', { outputs: docs });
  expect(run.jobs).toEqual(['plan', 'fast', 'check']);
  expect(plannedGroups('fast', docs)).toEqual([
    'static:lint',
    'static:docs',
    'static:coverage',
    'static:dependencies',
    'unit:all',
    'step:build',
  ]);
});
