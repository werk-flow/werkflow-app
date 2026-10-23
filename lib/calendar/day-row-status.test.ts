import { describe, expect, test } from 'bun:test';
import type { CalendarBoardDay } from './board';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
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

describe('canManageBlock: the time_approval holder decides, as submitTimeCorrection does', () => {
  const holder = (role: 'admin' | 'buero', userId = `${role}-user`): EffectiveResponsibilityHolder => ({
    employeeRecordId: `${role}-record`,
    userId,
    source: { kind: 'role_default', configurationId: null, role },
  });
  type Case = Partial<Parameters<typeof canManageBlock>[2]> & {
    block?: CalendarWorkBlock;
    entryUserRole?: string | undefined;
  };
  // The case names what differs from an admin holder looking at an employee's block.
  const manage = (overrides: Case = {}): boolean => {
    const { block: managed = block(), ...viewer } = overrides;
    const entryUserRole = 'entryUserRole' in overrides ? overrides.entryUserRole : 'employee';
    return canManageBlock(managed, entryUserRole, {
      currentUserRole: 'admin',
      currentUserId: 'admin-user',
      approvalHolder: holder('admin'),
      closedPeriods: [],
      ...viewer,
    });
  };

  test("a holder manages another person's block the way the holder may approve it", () => {
    expect(manage()).toBe(true);
    expect(manage({ entryUserRole: 'buero' })).toBe(true);
    expect(
      manage({ currentUserRole: 'buero', currentUserId: 'buero-user', approvalHolder: holder('buero') }),
    ).toBe(true);
    expect(
      manage({
        currentUserRole: 'buero',
        currentUserId: 'buero-user',
        approvalHolder: holder('buero'),
        entryUserRole: 'buero',
      }),
    ).toBe(false);
  });

  test("a manager without the holder role may not move another person's block, whatever the role", () => {
    expect(manage({ approvalHolder: null })).toBe(false);
    expect(manage({ currentUserRole: 'buero', currentUserId: 'buero-user', approvalHolder: null })).toBe(
      false,
    );
    expect(manage({ entryUserRole: undefined })).toBe(false);
  });

  test('a manager moves their own block without a holder; an employee moves none', () => {
    expect(manage({ currentUserId: 'owner', approvalHolder: null, entryUserRole: 'admin' })).toBe(true);
    expect(manage({ currentUserRole: 'employee', currentUserId: 'owner', approvalHolder: null })).toBe(false);
    expect(manage({ currentUserRole: 'employee', currentUserId: 'someone' })).toBe(false);
  });

  test('a block with a pending deletion stays locked for everyone', () => {
    expect(manage({ block: block('pending_delete') })).toBe(false);
  });

  test('a block of a closed period stays locked for everyone, the month after it does not', () => {
    const october = [{ startDate: '2026-10-01', endDate: '2026-10-31' }];
    const september = [{ startDate: '2026-09-01', endDate: '2026-09-30' }];
    expect(manage({ closedPeriods: october })).toBe(false);
    expect(manage({ closedPeriods: september })).toBe(true);
  });
});
