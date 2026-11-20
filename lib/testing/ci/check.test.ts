// `Check` fails closed: a missing, cancelled, failed or incomplete job fails it, and a skipped job
// passes only with the plan's reason (lib/testing/ci/check.ts).
import { expect, test } from 'bun:test';
import { checkRun, parseScheduler } from './check';
import type { CiJob } from './dag';
import type { CiResult, RunPlan } from './results';
import { plannedGroups } from './run-plan';

const TREE = 'a'.repeat(40);

function result(job: CiJob, overrides: Partial<CiResult> = {}): CiResult {
  return {
    version: 1,
    job,
    shard: null,
    event: 'integration',
    tree: TREE,
    commit: 'c'.repeat(40),
    base: 'b'.repeat(40),
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'github-actions',
    runUrl: null,
    startedAt: '2026-11-20T20:00:00.000Z',
    completedAt: '2026-11-20T20:05:00.000Z',
    ...overrides,
  };
}

const RUN_PLAN: RunPlan = {
  jobs: ['plan', 'fast', 'sql', 'components', 'browser', 'check'],
  skips: { midnight: 'No browser shard waits for the midnight start window.' },
  shards: [
    { shard: 1, groups: 'golden:p1-01' },
    { shard: 2, groups: 'audit:lab:calendar' },
  ],
  outputs: {},
};
const RUN = { tree: TREE, event: 'integration', runUrl: null, producer: null } as const;
const plan = result('plan', { plan: RUN_PLAN });
/** A passed result of the job that holds every group the plan gives it. */
const passed = (job: CiJob, shard: number | null = null): CiResult =>
  result(job, {
    shard,
    groups: plannedGroups(
      job,
      RUN_PLAN.outputs,
      RUN_PLAN.shards.find((entry) => entry.shard === shard)?.groups,
    ).map((id) => ({ id, outcome: 'passed', durationMs: 1 })),
  });
const passing = [
  passed('fast'),
  passed('sql'),
  passed('components'),
  passed('browser', 1),
  passed('browser', 2),
];

test('every planned job passed and every skip has its reason: Check passes', () => {
  const verdict = checkRun({ run: RUN, plan, results: passing, scheduler: undefined });
  expect(verdict.passed).toBe(true);
  expect(verdict.lines).toContain('midnight: skipped. No browser shard waits for the midnight start window.');
  expect(verdict.lines).toContain('browser 2: passed');
});

test('a missing job result fails Check, a missing shard included', () => {
  const missingSql = checkRun({
    run: RUN,
    plan,
    results: passing.filter((entry) => entry.job !== 'sql'),
    scheduler: undefined,
  });
  expect(missingSql.passed).toBe(false);
  expect(missingSql.lines).toContain('FAILED sql: no result');
  const missingShard = checkRun({ run: RUN, plan, results: passing.slice(0, 4), scheduler: undefined });
  expect(missingShard.lines).toContain('FAILED browser 2: no result');
});

test('a failed or incomplete job fails Check', () => {
  const failed = checkRun({
    run: RUN,
    plan,
    results: [...passing.slice(1), { ...passed('fast'), status: 'failed' }],
    scheduler: undefined,
  });
  expect(failed.lines).toContain('FAILED fast: failed');
  const running: CiResult = { ...passed('fast'), status: 'running', completedAt: null };
  expect(
    checkRun({ run: RUN, plan, results: [...passing.slice(1), running], scheduler: undefined }).lines,
  ).toContain('FAILED fast: the result is incomplete');
});

test("a cancelled or failed job by the scheduler's account fails Check, even beside a passed result", () => {
  const scheduler = parseScheduler(JSON.stringify({ sql: { result: 'cancelled', outputs: {} } }));
  const verdict = checkRun({ run: RUN, plan, results: passing, scheduler });
  expect(verdict.passed).toBe(false);
  expect(verdict.lines).toContain('FAILED sql: the job ended cancelled');
});

test('an unexplained skip fails Check: a planned job the scheduler skipped, or a skip the plan gives no reason for', () => {
  const scheduler = parseScheduler(JSON.stringify({ components: { result: 'skipped' } }));
  expect(checkRun({ run: RUN, plan, results: passing, scheduler }).lines).toContain(
    'FAILED components: the plan runs it, but the scheduler skipped it',
  );
  const silent = result('plan', { plan: { ...RUN_PLAN, skips: {} } });
  const verdict = checkRun({ run: RUN, plan: silent, results: passing, scheduler: undefined });
  expect(verdict.passed).toBe(false);
  expect(verdict.lines).toContain('FAILED midnight: skipped without a reason in the plan');
});

test("a missing or failed plan, an unreadable result and another tree's result fail Check", () => {
  expect(
    checkRun({
      run: RUN,
      plan: { unreadable: 'plan.json is missing' },
      results: passing,
      scheduler: undefined,
    }).passed,
  ).toBe(false);
  expect(
    checkRun({
      run: RUN,
      plan: result('plan', { status: 'failed', plan: RUN_PLAN }),
      results: passing,
      scheduler: undefined,
    }).passed,
  ).toBe(false);
  expect(
    checkRun({
      run: RUN,
      plan,
      results: [...passing, { unreadable: 'x.json is no JSON' }],
      scheduler: undefined,
    }).passed,
  ).toBe(false);
  const foreign = [...passing.slice(1), { ...passed('fast'), tree: 'f'.repeat(40) }];
  expect(checkRun({ run: RUN, plan, results: foreign, scheduler: undefined }).passed).toBe(false);
});

test('a browser job planned without a shard fails Check instead of passing on nothing', () => {
  const empty = result('plan', { plan: { ...RUN_PLAN, shards: [] } });
  expect(checkRun({ run: RUN, plan: empty, results: passing, scheduler: undefined }).lines).toContain(
    'FAILED browser: the plan runs it without a shard',
  );
});

test('a push whose tree already passed checks only its plan, and says which run stands for it', () => {
  const reused = result('plan', {
    event: 'main',
    reusedFrom: 'https://ci.example/runs/7',
    plan: {
      jobs: ['plan', 'check'],
      skips: Object.fromEntries(
        (['fast', 'sql', 'components', 'midnight', 'browser'] as const).map((job) => [job, 'Tree passed.']),
      ),
      shards: [],
      outputs: {},
    },
  });
  const verdict = checkRun({
    run: { tree: TREE, event: 'main', runUrl: null, producer: null },
    plan: reused,
    results: [],
    scheduler: undefined,
  });
  expect(verdict.passed).toBe(true);
  expect(verdict.lines).toContain('The run reuses https://ci.example/runs/7.');
});

test('a plan the scheduler cancelled, or the plan of another tree or event, fails Check', () => {
  const cancelled = parseScheduler(JSON.stringify({ plan: { result: 'cancelled' } }));
  expect(checkRun({ run: RUN, plan, results: passing, scheduler: cancelled }).lines).toEqual([
    'FAILED plan: the job ended cancelled',
  ]);
  for (const other of [
    { tree: 'f'.repeat(40), event: 'integration', runUrl: null, producer: null },
    { tree: TREE, event: 'pr', runUrl: null, producer: null },
    { tree: TREE, event: 'integration', runUrl: 'https://ci.example/runs/9', producer: null },
  ] as const)
    expect(checkRun({ run: other, plan, results: passing, scheduler: undefined }).passed).toBe(false);
  const incomplete = result('plan', { plan: RUN_PLAN, completedAt: null });
  expect(checkRun({ run: RUN, plan: incomplete, results: passing, scheduler: undefined }).passed).toBe(false);
});

test('a passed result that lacks a planned group, or holds it unpassed, fails Check', () => {
  const empty = passing.map((entry) => (entry.shard === 2 ? { ...entry, groups: [] } : entry));
  expect(checkRun({ run: RUN, plan, results: empty, scheduler: undefined }).lines).toContain(
    'FAILED browser 2: no passed result for audit:lab:calendar, step:server',
  );
  const notRun = passing.map((entry) =>
    entry.job === 'sql'
      ? { ...entry, groups: entry.groups.map((group) => ({ ...group, outcome: 'not-run' as const })) }
      : entry,
  );
  expect(checkRun({ run: RUN, plan, results: notRun, scheduler: undefined }).passed).toBe(false);
});

test("another event's result of the same tree fails Check", () => {
  const otherEvent = [...passing.slice(1), { ...passed('fast'), event: 'pr' as const }];
  expect(checkRun({ run: RUN, plan, results: otherEvent, scheduler: undefined }).lines).toContain(
    `FAILED fast: a result of another run (pr, tree ${TREE}, run null)`,
  );
});

test("an earlier run's leftover result of the same tree and event fails Check", () => {
  const leftover = [...passing.slice(1), { ...passed('fast'), runUrl: 'https://ci.example/runs/1' }];
  const verdict = checkRun({ run: RUN, plan, results: leftover, scheduler: undefined });
  expect(verdict.passed).toBe(false);
  expect(verdict.lines).toContain('FAILED fast: no result');
});

test("a CI runner's Check fails on a plan or job result without a producer, which a changed checkout leaves", () => {
  const ciRun = { ...RUN, producer: 'github-actions' };
  expect(checkRun({ run: ciRun, plan, results: passing, scheduler: undefined }).passed).toBe(true);
  const dirtyFast = [...passing.slice(1), { ...passed('fast'), producer: null }];
  expect(checkRun({ run: ciRun, plan, results: dirtyFast, scheduler: undefined }).lines).toContain(
    'FAILED fast: it ran outside CI or on a checkout that differs from its commit',
  );
  const dirtyPlan = { ...plan, producer: null };
  expect(checkRun({ run: ciRun, plan: dirtyPlan, results: passing, scheduler: undefined }).passed).toBe(
    false,
  );
});
