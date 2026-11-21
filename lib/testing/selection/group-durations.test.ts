// The packing hint learns from passed CI results only, and keeps every registered group.
import { expect, test } from 'bun:test';
import type { CiResult } from '../ci/results';
import { ledgerGroupResults, refreshGroupDurations, type GroupDurations } from './group-durations';

const current: GroupDurations = {
  source: 'earlier runs',
  defaultSeconds: 90,
  groups: { 'golden:gg-00': 30, 'audit:lab:office': 140, 'audit:retired': 50 },
};
const result = (groupId: string, status: string, seconds: number) => ({
  groupId,
  status,
  durationMs: seconds * 1000,
});

test('a registered group takes the median of its passed results, or keeps its recorded seconds', () => {
  const refreshed = refreshGroupDurations({
    current,
    results: [
      result('golden:gg-00', 'passed', 40),
      result('golden:gg-00', 'passed', 44),
      result('golden:gg-00', 'passed', 90),
      result('golden:p1-04', 'passed', 61.4),
    ],
    registered: ['golden:gg-00', 'audit:lab:office', 'golden:p1-04'],
    source: 'new runs',
  });
  expect(refreshed.groups).toEqual({ 'audit:lab:office': 140, 'golden:gg-00': 44, 'golden:p1-04': 61 });
  expect(refreshed.source).toBe('new runs');
});

test('a failed or blocked result never counts, and a group no longer registered drops out', () => {
  const refreshed = refreshGroupDurations({
    current,
    results: [result('golden:gg-00', 'failed', 3), result('golden:p1-04', 'blocked', 1)],
    registered: ['golden:gg-00', 'golden:p1-04'],
    source: 'new runs',
  });
  expect(refreshed.groups).toEqual({ 'golden:gg-00': 30 });
});

test('the default for a group without a record is the upper quartile of the recorded seconds', () => {
  const seconds = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const refreshed = refreshGroupDurations({
    current,
    results: seconds.map((value, index) => result(`audit:group-${index}`, 'passed', value)),
    registered: seconds.map((_, index) => `audit:group-${index}`),
    source: 'new runs',
  });
  expect(refreshed.defaultSeconds).toBe(70);
});

test("a ledger refresh takes the newest full runs' completed shards of a CI runner, and nothing else", () => {
  const receipt = (overrides: Partial<CiResult>): CiResult => ({
    version: 1,
    job: 'browser',
    shard: 1,
    event: 'full',
    tree: 'a'.repeat(40),
    commit: 'c'.repeat(40),
    base: null,
    status: 'passed',
    groups: [{ id: 'golden:gg-00', outcome: 'passed', durationMs: 40_000 }],
    planReason: 'Every browser group: Nightly run',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: 'run-2',
    startedAt: '2026-11-20T01:00:00.000Z',
    completedAt: '2026-11-20T01:30:00.000Z',
    ...overrides,
  });
  const ledger = [
    receipt({
      runUrl: 'run-1',
      startedAt: '2026-11-19T01:00:00.000Z',
      groups: [{ id: 'golden:gg-00', outcome: 'passed', durationMs: 1 }],
    }),
    receipt({}),
    receipt({
      job: 'components',
      groups: [{ id: 'ui:contracts:work', outcome: 'passed', durationMs: 20_000 }],
    }),
    receipt({
      runUrl: 'run-3',
      startedAt: '2026-11-21T01:00:00.000Z',
      groups: [{ id: 'golden:gg-00', outcome: 'failed', durationMs: 3_000 }],
    }),
    // Not a full run's shard, still running, or a workstation's: none counts.
    receipt({
      event: 'integration',
      runUrl: 'run-4',
      groups: [{ id: 'golden:p1-04', outcome: 'passed', durationMs: 9 }],
    }),
    receipt({
      runUrl: 'run-3',
      status: 'running',
      completedAt: null,
      groups: [{ id: 'golden:p1-04', outcome: 'not-run', durationMs: 0 }],
    }),
    receipt({
      producer: null,
      runUrl: 'run-5',
      groups: [{ id: 'golden:p1-04', outcome: 'passed', durationMs: 9 }],
    }),
    receipt({ job: 'check', runUrl: 'run-3', groups: [] }),
  ];
  const newest = ledgerGroupResults(ledger, 2);
  expect(newest.runs).toEqual(['run-2', 'run-3']);
  expect(newest.dates).toEqual(['2026-11-20', '2026-11-21']);
  expect(newest.results).toEqual([
    { groupId: 'golden:gg-00', status: 'passed', durationMs: 40_000 },
    { groupId: 'ui:contracts:work', status: 'passed', durationMs: 20_000 },
    { groupId: 'golden:gg-00', status: 'failed', durationMs: 3_000 },
  ]);
  const refreshed = refreshGroupDurations({
    current,
    results: newest.results,
    registered: ['golden:gg-00', 'ui:contracts:work'],
    source: 'ledger',
  });
  expect(refreshed.groups).toEqual({ 'golden:gg-00': 40, 'ui:contracts:work': 20 });
});
