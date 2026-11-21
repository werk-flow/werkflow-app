// The packing hint learns from passed CI results only, and keeps every registered group.
import { expect, test } from 'bun:test';
import { refreshGroupDurations, type GroupDurations } from './group-durations';

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
