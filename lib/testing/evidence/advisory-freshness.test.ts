// Rule test: a plan and a push carry a dependency advisory pass under 24 hours old.
import { expect, test } from 'bun:test';
import { ADVISORY_GROUP_ID, advisoryFreshnessProblem, freshAdvisoryPass } from './advisory-freshness';
import type { GroupResult } from './group-evidence';

const now = new Date('2026-10-23T12:00:00.000Z');
const hoursBefore = (hours: number): string => new Date(now.getTime() - hours * 3_600_000).toISOString();
const pass = (completedAt: string): GroupResult => ({
  groupId: ADVISORY_GROUP_ID,
  fingerprint: 'a'.repeat(64),
  status: 'passed',
  startedAt: completedAt,
  completedAt,
  durationMs: 1_000,
  runKey: null,
  buildId: null,
  logPath: 'static-dependencies.log',
  reason: null,
});

test('probe: a plan copies an advisory pass under 24 hours old and asks the registry again after', () => {
  expect(freshAdvisoryPass(pass(hoursBefore(23)), now)?.completedAt).toBe(hoursBefore(23));
  expect(freshAdvisoryPass(pass(hoursBefore(24)), now)).toBeDefined();
  expect(freshAdvisoryPass(pass(hoursBefore(24.01)), now)).toBeUndefined();
  // No reusable pass, an unverified (failed) check, and a completion time in the future are no fresh pass.
  expect(freshAdvisoryPass(undefined, now)).toBeUndefined();
  expect(freshAdvisoryPass({ ...pass(hoursBefore(1)), status: 'failed' }, now)).toBeUndefined();
  expect(freshAdvisoryPass(pass(new Date(now.getTime() + 60_000).toISOString()), now)).toBeUndefined();
});

test('probe: the gate refuses a report without a passing advisory check under 24 hours old', () => {
  const report = (results: { groupId: string; status: string; completedAt: string }[]) => ({
    id: 'report-1',
    results,
  });
  const result = (status: string, hours: number) => ({
    groupId: ADVISORY_GROUP_ID,
    status,
    completedAt: hoursBefore(hours),
  });
  expect(advisoryFreshnessProblem(report([result('passed', 2)]), now)).toBeUndefined();
  expect(advisoryFreshnessProblem(report([result('passed', 25)]), now)).toContain('holds a pass from');
  expect(advisoryFreshnessProblem(report([result('failed', 1)]), now)).toContain('unverified');
  expect(advisoryFreshnessProblem(report([]), now)).toContain('holds no result of it');
  expect(
    advisoryFreshnessProblem(report([{ ...result('passed', 1), groupId: 'static:docs' }]), now),
  ).toContain('holds no result of it');
});
