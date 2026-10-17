import { expect, test } from 'bun:test';
import type { TraceStages } from '../runs/replay-checkpoint';
import { failedTestsWroteWorld, freshDiagnosisProblem, recoveredEnvironmentRuns } from './group-recovery';

const failed = {
  runKey: 'failed',
  sourceRunKey: null,
  lane: 'group',
  groupId: 'audit:wave-2:p1-14',
  status: 'failed_retained',
  classification: 'environment',
  cleanedAt: '2026-09-06T11:00:00Z',
  startedAt: '2026-09-06T09:00:00Z',
  completedAt: '2026-09-06T09:01:00Z',
  target: 'local',
  buildId: 'build-a',
  selectedTestIds: ['spec › first', 'spec › second'],
};
const diagnostic = {
  ...failed,
  runKey: 'diagnostic',
  sourceRunKey: 'failed',
  lane: 'diagnostic',
  groupId: undefined,
  status: 'diagnostic_passed',
  classification: null,
  cleanedAt: null,
  startedAt: '2026-09-06T10:00:00Z',
  completedAt: '2026-09-06T10:05:00Z',
  selectedTestIds: ['spec › second'],
};
const fresh = {
  ...diagnostic,
  runKey: 'fresh',
  diagnosticWorld: 'fresh' as const,
  startedAt: '2026-09-06T12:00:00Z',
  completedAt: '2026-09-06T12:05:00Z',
  selectedTestIds: ['spec › first', 'spec › second'],
};

test('environment recovery requires a passed retained diagnosis on the same build and target, after cleanup', () => {
  expect(recoveredEnvironmentRuns([failed, diagnostic])).toEqual(['failed']);
  expect(recoveredEnvironmentRuns([failed, { ...diagnostic, diagnosticWorld: 'retained' }])).toEqual([
    'failed',
  ]);
  for (const change of [
    { target: 'cloud' },
    { buildId: 'build-b' },
    { buildId: null },
    { status: 'failed' },
    { sourceRunKey: 'unrelated' },
    { startedAt: '2026-09-06T08:00:00Z' },
    { completedAt: null },
    { completedAt: '2026-09-06T12:00:00Z' },
    { completedAt: 'invalid' },
    { completedAt: '2026-09-06T09:59:00Z' },
  ]) {
    expect(recoveredEnvironmentRuns([failed, { ...diagnostic, ...change }])).toEqual([]);
  }
  expect(recoveredEnvironmentRuns([{ ...failed, cleanedAt: null }, diagnostic])).toEqual([]);
  expect(
    recoveredEnvironmentRuns([
      { ...failed, buildId: null },
      { ...diagnostic, buildId: null },
    ]),
  ).toEqual([]);
  expect(
    recoveredEnvironmentRuns([
      { ...failed, target: undefined },
      { ...diagnostic, target: undefined },
    ]),
  ).toEqual([]);
  expect(recoveredEnvironmentRuns([{ ...failed, classification: 'product' }, diagnostic])).toEqual([]);
});

test('a fresh-world diagnosis of the whole group on the same build qualifies, also after cleanup', () => {
  expect(recoveredEnvironmentRuns([failed, fresh])).toEqual(['failed']);
  for (const change of [
    { target: 'cloud' },
    { buildId: 'build-b' },
    { status: 'failed' },
    { status: 'passed' },
    { sourceRunKey: null },
    { startedAt: '2026-09-06T08:00:00Z' },
    { completedAt: null },
    // A fresh world must run every test of the failed group, not only the failed one.
    { selectedTestIds: ['spec › second'] },
    { selectedTestIds: [] },
  ]) {
    expect(recoveredEnvironmentRuns([failed, { ...fresh, ...change }])).toEqual([]);
  }
  expect(recoveredEnvironmentRuns([{ ...failed, selectedTestIds: [] }, fresh])).toEqual([]);
  // Only the first fresh-world diagnosis counts: a failed one cannot be followed by a passing one.
  const firstFailed = { ...fresh, runKey: 'fresh-0', status: 'failed', startedAt: '2026-09-06T11:30:00Z' };
  expect(recoveredEnvironmentRuns([failed, firstFailed, fresh])).toEqual([]);
});

const wrote: TraceStages = { completed: ['Arrange'], failed: 'Act', bodyStarted: true };
const hooksOnly: TraceStages = { completed: [], failed: null, bodyStarted: false };

test('a failed test wrote its world unless its trace shows a failure before the body', () => {
  expect(failedTestsWroteWorld([hooksOnly])).toBe(false);
  expect(failedTestsWroteWorld([wrote])).toBe(true);
  expect(failedTestsWroteWorld([{ completed: [], failed: 'Act', bodyStarted: true }])).toBe(true);
  expect(failedTestsWroteWorld([null])).toBe(true);
  expect(failedTestsWroteWorld([hooksOnly, null])).toBe(true);
  expect(failedTestsWroteWorld([])).toBe(true);
});

test('a fresh-world diagnosis starts only for an environment failure of a group that wrote its world, once', () => {
  type FreshInput = Parameters<typeof freshDiagnosisProblem>[0];
  const ready: FreshInput = {
    source: failed,
    servedBuildId: 'build-a',
    runs: [failed],
    failedTestStages: [wrote],
  };
  expect(freshDiagnosisProblem(ready)).toBeUndefined();
  const refusals: [Partial<FreshInput>, string][] = [
    [{ source: { ...failed, lane: 'iteration' } }, 'no group run'],
    [{ source: { ...failed, groupId: undefined } }, 'no group run'],
    [{ source: { ...failed, status: 'passed' } }, 'did not fail'],
    [{ source: { ...failed, classification: null } }, 'classified not yet'],
    [{ source: { ...failed, classification: 'harness' } }, 'classified harness'],
    [{ servedBuildId: 'build-b' }, 'served build is build-b'],
    [{ servedBuildId: null }, 'served build is unknown'],
    [{ runs: [failed, fresh] }, 'already diagnosed'],
    [{ runs: [failed, { ...fresh, status: 'failed' }] }, 'already diagnosed'],
    [{ failedTestStages: [hooksOnly] }, 'retained world'],
  ];
  for (const [change, message] of refusals)
    expect(freshDiagnosisProblem({ ...ready, ...change })).toContain(message);
  // A retained replay of the same run does not use up the fresh-world diagnosis.
  expect(freshDiagnosisProblem({ ...ready, runs: [failed, diagnostic] })).toBeUndefined();
});
