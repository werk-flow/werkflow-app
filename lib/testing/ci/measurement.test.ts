// A job measures its own cost and reads the runner's measurement inputs without ever failing on
// them: an unreadable input is recorded as unknown, so the receipt still parses for Check and reuse.
import { expect, test } from 'bun:test';
import { jobCost, measurementInputs, pullRequestsOf } from './measurement';
import type { CiResult } from './results';

const T0 = Date.parse('2026-11-21T08:00:00.000Z');
const MINUTE = 60_000;
const at = (minute: number): string => new Date(T0 + minute * MINUTE).toISOString();

test('a job cost adds the runner setup before the body and a shard server start, and no gate step', () => {
  const result: CiResult = {
    version: 1,
    job: 'browser',
    shard: 1,
    event: 'integration',
    tree: 'c'.repeat(40),
    commit: 'c'.repeat(40),
    base: null,
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: 'https://ci.example/runs/1',
    startedAt: at(10),
    completedAt: at(30),
  };
  const groups: CiResult['groups'] = [
    { id: 'step:server', outcome: 'passed', durationMs: 4 * MINUTE },
    { id: 'golden:p1-01', outcome: 'passed', durationMs: 12 * MINUTE },
  ];
  expect(
    jobCost({ ...result, groups }, { machineStart: true, runnerStartedAt: at(7), completedAt: at(30) }),
  ).toEqual({ machineStart: true, runnerStartedAt: at(7), setupMs: 7 * MINUTE, wallMs: 23 * MINUTE });
  expect(
    jobCost({ ...result, groups }, { machineStart: false, runnerStartedAt: null, completedAt: null }),
  ).toEqual({ machineStart: false, runnerStartedAt: null, setupMs: 4 * MINUTE, wallMs: null });
  // A runner clock ahead of the body's start counts from the body's start.
  expect(
    jobCost({ ...result, groups: [] }, { machineStart: true, runnerStartedAt: at(12), completedAt: at(30) }),
  ).toEqual({ machineStart: true, runnerStartedAt: at(12), setupMs: 0, wallMs: 20 * MINUTE });
});

test('a pull request list is numbers or a merge-queue ref; anything else is unreadable', () => {
  expect(pullRequestsOf(undefined)).toEqual([]);
  expect(pullRequestsOf('12')).toEqual([12]);
  expect(pullRequestsOf('14,15,14')).toEqual([14, 15]);
  expect(pullRequestsOf(`refs/heads/gh-readonly-queue/main/pr-568-${'a'.repeat(40)}`)).toEqual([568]);
  for (const value of [
    '0',
    '12,',
    'pr-12',
    '#12',
    '9007199254740992',
    `refs/heads/gh-readonly-queue/main/pr-0-${'a'.repeat(40)}`,
  ])
    expect([value, 'unreadable' in pullRequestsOf(value)]).toEqual([value, true]);
});

test('an unreadable measurement input warns and records unknown, so it never fails a job', () => {
  const { warnings, ...unknown } = measurementInputs({
    CI_PRS: 'twelve',
    CI_RUN_ATTEMPT: '9007199254740992',
    CI_FIRST_ATTEMPT_CLASS: 'transient',
    CI_JOB_STARTED_AT: 'soon',
    CI_MACHINE_START: 'maybe',
  });
  // An unreadable CI_MACHINE_START counts a machine start, as every CI job did before it.
  expect(unknown).toEqual({
    prs: [],
    attempt: null,
    firstAttemptClass: null,
    runnerStartedAt: null,
    machineStart: true,
  });
  // An unset CI_RUN_ATTEMPT still means the first attempt.
  expect(measurementInputs({}).attempt).toBe(1);
  expect(warnings.map((warning) => warning.split(' ')[0])).toEqual([
    'CI_PRS',
    'CI_RUN_ATTEMPT',
    'CI_FIRST_ATTEMPT_CLASS',
    'CI_JOB_STARTED_AT',
    'CI_MACHINE_START',
  ]);
  expect(
    measurementInputs({
      CI_PRS: '12',
      CI_RUN_ATTEMPT: '2',
      CI_FIRST_ATTEMPT_CLASS: 'environment',
      CI_JOB_STARTED_AT: at(0),
      CI_MACHINE_START: 'false',
    }),
  ).toEqual({
    prs: [12],
    attempt: 2,
    firstAttemptClass: 'environment',
    runnerStartedAt: at(0),
    machineStart: false,
    warnings: [],
  });
});
