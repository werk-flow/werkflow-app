import { expect, test } from 'bun:test';

import { parseBreakPolicyHistory } from '@/lib/time-tracking/settings';

const policy = { breakMode: 'automatic', autoBreakThresholdMinutes: 360, autoBreakDurationMinutes: 30 };

test('a history entry written by Postgres with a +00:00 offset is kept and read in the Z form', () => {
  const history = parseBreakPolicyHistory([
    { ...policy, effectiveFrom: '2026-01-01T00:00:00+00:00' },
    { ...policy, breakMode: 'manual', effectiveFrom: '2026-03-01T08:30:00.000Z' },
  ]);

  expect(history.map((entry) => entry.effectiveFrom)).toEqual([
    '2026-01-01T00:00:00.000Z',
    '2026-03-01T08:30:00.000Z',
  ]);
});

test('a non-UTC offset is normalized to the same instant and sorted by it', () => {
  const history = parseBreakPolicyHistory([
    { ...policy, effectiveFrom: '2026-02-01T00:00:00.000Z' },
    { ...policy, breakMode: 'manual', effectiveFrom: '2026-02-01T00:30:00+02:00' },
  ]);

  expect(history.map((entry) => [entry.breakMode, entry.effectiveFrom])).toEqual([
    ['manual', '2026-01-31T22:30:00.000Z'],
    ['automatic', '2026-02-01T00:00:00.000Z'],
  ]);
});

test('an entry without a valid timestamp is dropped', () => {
  expect(parseBreakPolicyHistory([{ ...policy, effectiveFrom: '2026-01-01' }])).toEqual([]);
});
