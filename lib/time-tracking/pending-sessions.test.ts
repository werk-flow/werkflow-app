import { expect, test } from 'bun:test';

import { groupPendingEntries } from './pending-sessions';
import type { TimeEntryRow } from './types';

let sequence = 0;

function row(overrides: Partial<TimeEntryRow> & { entry_type: string; timestamp: string }): TimeEntryRow {
  sequence += 1;
  return {
    id: `entry-${sequence}`,
    user_id: 'user-a',
    organization_id: 'org',
    is_manual: true,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-09-18T08:09:08.000Z',
    updated_at: '2026-09-18T08:09:08.000Z',
    job_id: null,
    capture_source: 'employee',
    operation_id: null,
    recovery_reason: null,
    ...overrides,
  } as TimeEntryRow;
}

test('a submission with breaks becomes one session that owns every row', () => {
  const rows = [
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T14:00:00Z' }),
    row({ entry_type: 'break_end', timestamp: '2026-09-15T10:30:00Z' }),
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T05:00:00Z' }),
    row({ entry_type: 'break_start', timestamp: '2026-09-15T10:00:00Z' }),
  ];
  const groups = groupPendingEntries(rows);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.clockIn?.entry_type).toBe('clock_in');
  expect(groups[0]?.clockOut?.entry_type).toBe('clock_out');
  expect(groups[0]?.entries.map((entry) => entry.entry_type)).toEqual(['clock_in', 'break_start', 'break_end', 'clock_out']);
  expect(groups[0]?.date).toBe('2026-09-15');
});

test('rows of different days never pair even when created in the same instant', () => {
  // The 2026-09-18 bulk insert: four days of entries with one created_at.
  const rows = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].flatMap((day) => [
    row({ entry_type: 'clock_in', timestamp: `${day}T05:00:00Z` }),
    row({ entry_type: 'clock_out', timestamp: `${day}T14:00:00Z` }),
  ]);
  const groups = groupPendingEntries(rows);
  expect(groups).toHaveLength(4);
  for (const group of groups) {
    expect(group.clockIn?.timestamp.slice(0, 10)).toBe(group.clockOut?.timestamp.slice(0, 10));
    expect(group.entries).toHaveLength(2);
  }
});

test('two submissions on one day stay separate and the newest sorts first', () => {
  const rows = [
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T05:00:00Z', created_at: '2026-09-15T15:00:00Z' }),
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T09:00:00Z', created_at: '2026-09-15T15:00:01Z' }),
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T11:00:00Z', created_at: '2026-09-16T07:00:00Z' }),
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T15:00:00Z', created_at: '2026-09-16T07:00:00Z' }),
  ];
  const groups = groupPendingEntries(rows);
  expect(groups.map((group) => group.clockIn?.timestamp)).toEqual(['2026-09-15T11:00:00Z', '2026-09-15T05:00:00Z']);
});

test('one submission with two sessions pairs each clock-in with the clock-out that follows it', () => {
  const rows = [
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T05:00:00Z' }),
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T09:00:00Z' }),
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T11:00:00Z' }),
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T15:00:00Z' }),
  ];
  const groups = groupPendingEntries(rows);
  expect(groups.map((group) => [group.clockIn?.timestamp, group.clockOut?.timestamp])).toEqual([
    ['2026-09-15T05:00:00Z', '2026-09-15T09:00:00Z'],
    ['2026-09-15T11:00:00Z', '2026-09-15T15:00:00Z'],
  ]);
});

test('users and unpaired rows are kept apart', () => {
  const rows = [
    row({ entry_type: 'clock_in', timestamp: '2026-09-15T05:00:00Z', user_id: 'user-a' }),
    row({ entry_type: 'clock_out', timestamp: '2026-09-15T14:00:00Z', user_id: 'user-b' }),
    row({ entry_type: 'break_start', timestamp: '2026-09-15T10:00:00Z', user_id: 'user-c' }),
  ];
  const groups = groupPendingEntries(rows);
  expect(groups).toHaveLength(3);
  expect(groups.every((group) => group.entries.length === 1)).toBe(true);
  expect(groups.find((group) => group.userId === 'user-b')?.clockOut).not.toBeNull();
  expect(groups.find((group) => group.userId === 'user-c')?.clockIn).toBeNull();
});
