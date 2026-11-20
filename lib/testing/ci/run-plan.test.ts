// Which jobs a run executes: the fast tier for a PR, browser shards once in the integration run,
// nothing for a push whose tree already passed, and reuse only where a receipt stands
// (lib/testing/ci/run-plan.ts).
import { expect, test } from 'bun:test';
import type { CiEvent } from './dag';
import type { ReuseKey } from './reuse';
import { planRun } from './run-plan';

const TREE = 'a'.repeat(40);
const SHARDS = [
  { shard: 1, groups: 'audit:visual:one,audit:visual:two' },
  { shard: 2, groups: 'golden:p1-01,audit:lab:calendar' },
];
const OUTPUTS = {
  browser: 'true',
  full: 'false',
  shards: JSON.stringify(SHARDS),
  midnight_until: '',
  static: 'static:typecheck,static:docs',
  sql: 'sql:grants,sql:history',
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

test('an empty browser selection skips the shards with the reason', () => {
  const empty = plan('integration', { outputs: { ...OUTPUTS, browser: 'false', shards: '[]' } });
  expect(empty.jobs).not.toContain('browser');
  expect(empty.skips.browser).toBe('The plan selects no browser group.');
});

test('a push to main whose tree an integration run passed runs no job and cites that run', () => {
  const pushed = plan('main', { passedTree: 'https://ci.example/runs/7' });
  expect(pushed.jobs).toEqual(['plan', 'check']);
  for (const job of ['fast', 'sql', 'components', 'midnight', 'browser'] as const)
    expect(pushed.skips[job]).toBe('The integration run https://ci.example/runs/7 passed this exact tree.');
  // Only a push reuses a whole run: a queue run of the same tree still runs.
  expect(plan('integration', { passedTree: 'https://ci.example/runs/7' }).jobs).toContain('browser');
});

test('a reused job and a reused shard do not run; the key carries the steps and the approval', () => {
  const keys: ReuseKey[] = [];
  const run = plan('integration', {
    reused: (key) => {
      keys.push(key);
      return key.job === 'sql' || key.groups.includes('golden:p1-01')
        ? 'https://ci.example/runs/3'
        : undefined;
    },
  });
  expect(run.jobs).toEqual(['plan', 'fast', 'components', 'browser', 'check']);
  expect(run.skips.sql).toContain('https://ci.example/runs/3');
  expect(run.shards).toEqual(SHARDS.slice(0, 1));
  expect(keys).toContainEqual({
    job: 'sql',
    tree: TREE,
    groups: ['sql:grants', 'sql:history', 'step:types', 'step:seed'],
    listGrowthApproved: false,
  });
  expect(keys).toContainEqual({
    job: 'components',
    tree: TREE,
    groups: ['ui:contracts'],
    listGrowthApproved: false,
  });
  expect(keys.some((key) => key.job === 'fast')).toBe(false);
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
