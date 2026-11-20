// `Check` fails closed: a missing, cancelled, failed or incomplete job fails it, and a skipped job
// passes only with the plan's reason (lib/testing/ci/check.ts).
import { expect, test } from 'bun:test';
import { checkRun, parseScheduler } from './check';
import type { CiJob } from './dag';
import type { CiResult, RunPlan } from './results';

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
const plan = result('plan', { plan: RUN_PLAN });
const passing = [
  result('fast'),
  result('sql'),
  result('components'),
  result('browser', { shard: 1 }),
  result('browser', { shard: 2 }),
];

test('every planned job passed and every skip has its reason: Check passes', () => {
  const verdict = checkRun({ plan, results: passing, scheduler: undefined });
  expect(verdict.passed).toBe(true);
  expect(verdict.lines).toContain('midnight: skipped. No browser shard waits for the midnight start window.');
  expect(verdict.lines).toContain('browser 2: passed');
});

test('a missing job result fails Check, a missing shard included', () => {
  const missingSql = checkRun({
    plan,
    results: passing.filter((entry) => entry.job !== 'sql'),
    scheduler: undefined,
  });
  expect(missingSql.passed).toBe(false);
  expect(missingSql.lines).toContain('FAILED sql: no result');
  const missingShard = checkRun({ plan, results: passing.slice(0, 4), scheduler: undefined });
  expect(missingShard.lines).toContain('FAILED browser 2: no result');
});

test('a failed or incomplete job fails Check', () => {
  const failed = checkRun({
    plan,
    results: [...passing.slice(1), result('fast', { status: 'failed' })],
    scheduler: undefined,
  });
  expect(failed.lines).toContain('FAILED fast: failed');
  const running = result('fast', { status: 'running', completedAt: null });
  expect(checkRun({ plan, results: [...passing.slice(1), running], scheduler: undefined }).lines).toContain(
    'FAILED fast: the result is incomplete',
  );
});

test("a cancelled or failed job by the scheduler's account fails Check, even beside a passed result", () => {
  const scheduler = parseScheduler(JSON.stringify({ sql: { result: 'cancelled', outputs: {} } }));
  const verdict = checkRun({ plan, results: passing, scheduler });
  expect(verdict.passed).toBe(false);
  expect(verdict.lines).toContain('FAILED sql: the job ended cancelled');
});

test('an unexplained skip fails Check: a planned job the scheduler skipped, or a skip the plan gives no reason for', () => {
  const scheduler = parseScheduler(JSON.stringify({ components: { result: 'skipped' } }));
  expect(checkRun({ plan, results: passing, scheduler }).lines).toContain(
    'FAILED components: the plan runs it, but the scheduler skipped it',
  );
  const silent = result('plan', { plan: { ...RUN_PLAN, skips: {} } });
  const verdict = checkRun({ plan: silent, results: passing, scheduler: undefined });
  expect(verdict.passed).toBe(false);
  expect(verdict.lines).toContain('FAILED midnight: skipped without a reason in the plan');
});

test("a missing or failed plan, an unreadable result and another tree's result fail Check", () => {
  expect(
    checkRun({ plan: { unreadable: 'plan.json is missing' }, results: passing, scheduler: undefined }).passed,
  ).toBe(false);
  expect(
    checkRun({
      plan: result('plan', { status: 'failed', plan: RUN_PLAN }),
      results: passing,
      scheduler: undefined,
    }).passed,
  ).toBe(false);
  expect(
    checkRun({ plan, results: [...passing, { unreadable: 'x.json is no JSON' }], scheduler: undefined })
      .passed,
  ).toBe(false);
  const foreign = [...passing.slice(1), result('fast', { tree: 'f'.repeat(40) })];
  expect(checkRun({ plan, results: foreign, scheduler: undefined }).passed).toBe(false);
});

test('a browser job planned without a shard fails Check instead of passing on nothing', () => {
  const empty = result('plan', { plan: { ...RUN_PLAN, shards: [] } });
  expect(checkRun({ plan: empty, results: passing, scheduler: undefined }).lines).toContain(
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
  const verdict = checkRun({ plan: reused, results: [], scheduler: undefined });
  expect(verdict.passed).toBe(true);
  expect(verdict.lines).toContain('The run reuses https://ci.example/runs/7.');
});
