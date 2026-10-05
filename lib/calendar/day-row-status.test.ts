import { describe, expect, test } from 'bun:test';
import type { CalendarBoardDay } from './board';
import type { CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { canManageBlock, dayRowLabel, isDayRowOff } from './day-row-status';

function boardDay(overrides: Partial<CalendarBoardDay> = {}): CalendarBoardDay {
  return {
    employeeRecordId: 'r1',
    date: '2026-10-05',
    targetMinutes: 480,
    baseTargetMinutes: 480,
    reason: 'working',
    label: null,
    absence: null,
    pendingVacation: false,
    ...overrides,
  };
}

function entry(status: TimeEntry['status']): TimeEntry {
  return {
    id: `entry-${status}`,
    userId: 'owner',
    organizationId: 'org-1',
    entryType: 'clock_in',
    timestamp: '2026-10-05T07:00:00Z',
    isManual: false,
    jobId: null,
    status,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-10-05T07:00:00Z',
    updatedAt: '2026-10-05T07:00:00Z',
  };
}

function block(status: TimeEntry['status'] = 'approved'): CalendarWorkBlock {
  const start = entry(status);
  return {
    id: 'block-1',
    userId: 'owner',
    organizationId: 'org-1',
    jobId: null,
    start: start.timestamp,
    end: null,
    startEntry: start,
    endEntry: null,
    segments: [],
    sourceEntries: [start],
    isOpen: true,
    isOnBreak: false,
    isComposite: false,
    isPending: false,
  };
}

describe('dayRowLabel and isDayRowOff', () => {
  test('a working day has no note and is not off', () => {
    expect(dayRowLabel(undefined)).toBeNull();
    expect(dayRowLabel(boardDay())).toBeNull();
    expect(isDayRowOff(undefined)).toBe(false);
    expect(isDayRowOff(boardDay())).toBe(false);
  });

  test('an absence names its kind; only a full absence is off', () => {
    const half = boardDay({ absence: { type: 'vacation', portion: 'half_day' } });
    expect(dayRowLabel(half)).toBe('Urlaub (halber Tag)');
    expect(isDayRowOff(half)).toBe(false);
    expect(dayRowLabel(boardDay({ absence: { type: 'vacation', portion: 'full' } }))).toBe('Urlaub');
    const sick = boardDay({ absence: { type: 'sickness', portion: 'full' } });
    expect(dayRowLabel(sick)).toBe('Krank');
    expect(isDayRowOff(sick)).toBe(true);
  });

  test('holiday and closure prefer their label; a day without target is no working day', () => {
    expect(dayRowLabel(boardDay({ reason: 'holiday', label: 'Tag der Deutschen Einheit' }))).toBe(
      'Tag der Deutschen Einheit',
    );
    expect(dayRowLabel(boardDay({ reason: 'holiday' }))).toBe('Feiertag');
    expect(dayRowLabel(boardDay({ reason: 'closure' }))).toBe('Betriebsruhe');
    const noTarget = boardDay({ targetMinutes: 0 });
    expect(dayRowLabel(noTarget)).toBe('Kein Arbeitstag');
    expect(isDayRowOff(noTarget)).toBe(true);
    expect(isDayRowOff(boardDay({ reason: 'no_work_day' }))).toBe(true);
  });
});

describe('canManageBlock', () => {
  test('admins manage every block, Büro own and employee blocks, employees none', () => {
    expect(canManageBlock(block(), 'admin', 'me', 'admin')).toBe(true);
    expect(canManageBlock(block(), 'buero', 'me', 'employee')).toBe(true);
    expect(canManageBlock(block(), 'buero', 'owner', 'buero')).toBe(true);
    expect(canManageBlock(block(), 'buero', 'me', 'admin')).toBe(false);
    expect(canManageBlock(block(), 'employee', 'owner', 'employee')).toBe(false);
  });

  test('a block with a pending deletion stays locked for everyone', () => {
    expect(canManageBlock(block('pending_delete'), 'admin', 'me', 'employee')).toBe(false);
  });
});
