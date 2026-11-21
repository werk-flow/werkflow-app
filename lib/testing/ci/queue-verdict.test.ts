// An integration run's verdict comes only from a CI runner's finished plan and Check of that run,
// commit, tree and base, and a failure counts only with a job of the run that failed a group
// (verdictOf in lib/testing/ci/queue.ts).
import { expect, test } from 'bun:test';
import { type RunEvidence, verdictOf } from './queue-verdict';
import type { CiResult } from './results';

const RUN = {
  commit: 'c'.repeat(40),
  tree: 'd'.repeat(40),
  base: 'e'.repeat(40),
  runUrl: 'queue/1',
  attempt: 1,
};
const PLAN_STARTED = '2026-11-21T08:00:00.000Z';

function result(overrides: Partial<CiResult>): CiResult {
  return {
    version: 1,
    job: 'check',
    shard: null,
    event: 'integration',
    tree: RUN.tree,
    commit: RUN.commit,
    base: RUN.base,
    status: 'passed',
    groups: [],
    planReason: '',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: RUN.runUrl,
    startedAt: PLAN_STARTED,
    completedAt: '2026-11-21T09:00:00Z',
    attempt: 1,
    // Check and every job name the Plan they ran under.
    planStartedAt: PLAN_STARTED,
    planIdentity: {
      runUrl: RUN.runUrl,
      attempt: 1,
      startedAt: PLAN_STARTED,
      base: RUN.base,
      digest: 'a'.repeat(64),
    },
    ...overrides,
  };
}

const PLAN = result({
  job: 'plan',
  plan: { jobs: ['plan', 'fast', 'check'], skips: {}, shards: [], outputs: {}, work: ['fast:step:build'] },
});
const START = result({ job: 'plan', status: 'running', completedAt: null });
/** The run's evidence: its plan, its Check and its results; no ledger unless given. */
const evidence = (check: RunEvidence['check'], changes: Partial<RunEvidence> = {}): RunEvidence => ({
  plan: PLAN,
  check,
  results: [],
  ledger: undefined,
  runnerPassed: true,
  ...changes,
});

test("only a CI runner's finished, passed Check of this run, commit and tree passes a batch", () => {
  expect(verdictOf(RUN, evidence(result({}))).kind).toBe('passed');
  for (const foreign of [
    { producer: null },
    { runUrl: 'queue/0' },
    { commit: 'f'.repeat(40) },
    { event: 'pr' as const },
  ])
    expect(verdictOf(RUN, evidence(result(foreign))).kind).toBe('inconclusive');
});

// A rerun under the same run URL plans again, perhaps on another base: a Check or a failed job of
// the first attempt's Plan never stands for the second's.
test("only the Check of this run's Plan and expected attempt passes a batch, and only that Plan's jobs fail it", () => {
  const secondPlan = result({ job: 'plan', attempt: 2, startedAt: '2026-11-21T10:00:00.000Z' });
  expect(verdictOf(RUN, evidence(result({}), { plan: secondPlan })).detail).toBe(
    'the plan is of attempt 2, not the expected attempt 1',
  );
  expect(verdictOf({ ...RUN, attempt: 2 }, evidence(result({}), { plan: secondPlan })).detail).toBe(
    'the Check result is of attempt 1, not the expected attempt 2',
  );
  const laterPlan = result({ job: 'plan', startedAt: '2026-11-21T10:00:00.000Z' });
  expect(verdictOf(RUN, evidence(result({}), { plan: laterPlan })).detail).toBe(
    `the Check verified the run by the Plan started ${PLAN_STARTED}, not by this plan of 2026-11-21T10:00:00.000Z`,
  );
  const { planStartedAt, ...unbound } = result({});
  expect(planStartedAt).toBe(PLAN_STARTED);
  expect(verdictOf(RUN, evidence(unbound)).kind).toBe('inconclusive');
  const failedGroup = result({
    job: 'sql',
    status: 'failed',
    groups: [{ id: 'sql:grants', outcome: 'failed', durationMs: 1 }],
  });
  const failedCheck = result({ status: 'failed' });
  expect(verdictOf(RUN, evidence(failedCheck, { results: [failedGroup] })).kind).toBe('failed');
  const { planIdentity, ...unplanned } = failedGroup;
  const earlierPlan = planIdentity && { ...planIdentity, startedAt: '2026-11-21T07:00:00.000Z' };
  for (const stale of [unplanned, { ...failedGroup, planIdentity: earlierPlan }])
    expect(verdictOf(RUN, evidence(failedCheck, { results: [stale] })).kind).toBe('inconclusive');
});

// A Check that wrote a pass and then failed is set failed by run-commit; when that rewrite failed
// too, only the runner's exit tells, so a pass needs both.
test("a Check's pass counts only when the runner exited 0 as well", () => {
  const failedRunner = verdictOf(RUN, evidence(result({}), { runnerPassed: false }));
  expect(failedRunner.kind).toBe('inconclusive');
  expect(failedRunner.detail).toBe('Check wrote a pass, but the runner did not exit 0');
});

test("a pass needs a CI runner's passed plan of this run against the batch's base", () => {
  expect(verdictOf(RUN, evidence(result({}), { plan: result({ job: 'plan', base: 'HEAD' }) })).detail).toBe(
    `the plan diffed against HEAD, not the batch's base ${RUN.base}`,
  );
  for (const plan of [
    { unreadable: 'plan.json is missing' },
    result({ job: 'plan', runUrl: 'queue/0' }),
    result({ job: 'plan', status: 'failed' }),
    result({ job: 'plan', producer: null }),
  ])
    expect(verdictOf(RUN, evidence(result({}), { plan })).kind).toBe('inconclusive');
});

test("with a ledger, a pass counts only when the ledger holds the run as its landing's pass, so the push to main reuses it", () => {
  const passed = result({ planStartedAt: PLAN.startedAt });
  expect(verdictOf(RUN, evidence(passed, { ledger: [START, PLAN, passed] })).kind).toBe('passed');
  // The push binds reuse to the plan's work: a plan that recorded none leaves the push to run.
  const unbound = result({ job: 'plan', plan: { jobs: [], skips: {}, shards: [], outputs: {} } });
  expect(verdictOf(RUN, evidence(passed, { plan: unbound, ledger: [START, unbound, passed] })).kind).toBe(
    'inconclusive',
  );
  expect(verdictOf(RUN, evidence(passed, { ledger: [] })).kind).toBe('inconclusive');
  expect(verdictOf(RUN, evidence(passed, { ledger: { unreadable: 'ledger.jsonl:3 is no JSON' } })).kind).toBe(
    'inconclusive',
  );
});

test('a missing Check result or one still running (a cancelled worker) is no verdict', () => {
  expect(verdictOf(RUN, evidence({ unreadable: 'check.json is missing' })).detail).toBe(
    'no Check result: check.json is missing',
  );
  expect(verdictOf(RUN, evidence(result({ status: 'running', completedAt: null }))).kind).toBe(
    'inconclusive',
  );
});

test('a failed Check counts against the batch only with a CI job of this run that failed a group; a missing artifact, a cancelled job or a changed checkout is no verdict', () => {
  const failedCheck = result({ status: 'failed' });
  const failedGroup = result({
    job: 'browser',
    shard: 1,
    status: 'failed',
    groups: [{ id: 'golden:p1-24a', outcome: 'failed', durationMs: 1 }],
  });
  expect(verdictOf(RUN, evidence(failedCheck, { results: [failedGroup] }))).toEqual({
    kind: 'failed',
    runUrl: RUN.runUrl,
    detail: 'failed: golden:p1-24a',
  });
  const noGroupRan = result({
    job: 'browser',
    shard: 1,
    status: 'failed',
    groups: [{ id: 'golden:p1-24a', outcome: 'not-run', durationMs: 0 }],
  });
  for (const results of [
    [noGroupRan, { unreadable: 'browser-2.json is missing' }],
    [{ ...failedGroup, runUrl: 'queue/0' }],
    [{ ...failedGroup, producer: null }],
    [{ ...failedGroup, status: 'running' as const, completedAt: null }],
  ])
    expect(verdictOf(RUN, evidence(failedCheck, { results })).kind).toBe('inconclusive');
});

test("a failure of the browser setup alone (the build hand-off or the server's start, before any assertion) is no verdict against the batch", () => {
  const failedCheck = result({ status: 'failed' });
  const setupOnly = result({
    job: 'browser',
    shard: 1,
    status: 'failed',
    groups: [
      { id: 'golden:p1-24a', outcome: 'not-run', durationMs: 0 },
      { id: 'step:server', outcome: 'failed', durationMs: 1 },
    ],
  });
  expect(verdictOf(RUN, evidence(failedCheck, { results: [setupOnly] }))).toEqual({
    kind: 'inconclusive',
    runUrl: RUN.runUrl,
    detail:
      'only the setup failed (step:server), before any assertion ran: an environment failure until a retry shows otherwise',
  });
  // Beside an assertion that failed, the batch failed.
  const assertion = result({
    job: 'sql',
    status: 'failed',
    groups: [{ id: 'sql:grants', outcome: 'failed', durationMs: 1 }],
  });
  expect(verdictOf(RUN, evidence(failedCheck, { results: [setupOnly, assertion] }))).toEqual({
    kind: 'failed',
    runUrl: RUN.runUrl,
    detail: 'failed: step:server, sql:grants',
  });
});
