import { describe, expect, test } from 'bun:test';

import type { EmploymentCondition } from '@/lib/personnel/types';
import type { WorkSchedule } from '@/lib/personnel/schedule';
import {
  EMPTY_HOLIDAY_CALENDAR,
  resolveDailyTarget,
  type OrganizationHolidayCalendar,
} from '@/lib/personnel/targets';
import {
  computeVacationBalance,
  countCalendarDaysInRange,
  countVacationDays,
  countVacationDaysByYear,
  formatVacationDays,
  isValidIsoDate,
  listIsoDatesInRange,
  MAX_VACATION_RANGE_DAYS,
  resolveVacationEntitlementForYear,
  type VacationCountingContext,
} from './balance';
import type { VacationRequest } from './types';

function makeSchedule(
  validFrom: string,
  dayMinutes: number[],
  id = `schedule-${validFrom}`
): WorkSchedule {
  return {
    id,
    organizationId: 'org-1',
    employeeRecordId: 'record-1',
    validFrom,
    dayMinutes,
    note: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeCondition(
  validFrom: string,
  vacationDaysPerYear: number | null,
  weeklyHours: number | null = null
): EmploymentCondition {
  return {
    id: `condition-${validFrom}`,
    organizationId: 'org-1',
    employeeRecordId: 'record-1',
    validFrom,
    employmentType: 'vollzeit',
    weeklyHours,
    vacationDaysPerYear,
    note: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeRequest(overrides: Partial<VacationRequest>): VacationRequest {
  return {
    id: 'request-1',
    organizationId: 'org-1',
    employeeRecordId: 'record-1',
    requestedBy: 'user-1',
    startDate: '2026-08-10',
    endDate: '2026-08-10',
    dayPortion: 'full',
    status: 'pending',
    comment: null,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedDaysByYear: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

const FULL_TIME = [480, 480, 480, 480, 480, 0, 0];
// Mo/Mi/Fr part-time pattern: Tuesday and Thursday are schedule-free.
const THREE_DAY_WEEK = [240, 0, 240, 0, 240, 0, 0];

const FULL_TIME_CONTEXT: VacationCountingContext = {
  schedules: [makeSchedule('2026-01-01', FULL_TIME)],
  conditions: [],
  calendar: EMPTY_HOLIDAY_CALENDAR,
};

const BAVARIA_CALENDAR: OrganizationHolidayCalendar = {
  holidayRegion: 'BY',
  holidayRegionHistory: [
    { region: 'BY', effectiveFrom: '2026-01-01T00:00:00Z' },
  ],
  closureDays: [],
};

describe('resolveVacationEntitlementForYear', () => {
  test('no conditions → null (labeled exception, never zero or 30)', () => {
    expect(resolveVacationEntitlementForYear([], 2026)).toBeNull();
  });

  test('condition without vacation days → null', () => {
    expect(
      resolveVacationEntitlementForYear([makeCondition('2026-01-01', null)], 2026)
    ).toBeNull();
  });

  test('newest condition effective within the year governs it', () => {
    const conditions = [
      makeCondition('2025-01-01', 28),
      makeCondition('2026-07-01', 32),
    ];
    expect(resolveVacationEntitlementForYear(conditions, 2025)).toBe(28);
    // Mid-year change: the latest value entered for the year applies.
    expect(resolveVacationEntitlementForYear(conditions, 2026)).toBe(32);
    expect(resolveVacationEntitlementForYear(conditions, 2027)).toBe(32);
  });

  test('a condition starting after the year does not affect it', () => {
    const conditions = [makeCondition('2027-01-01', 30)];
    expect(resolveVacationEntitlementForYear(conditions, 2026)).toBeNull();
  });
});

describe('listIsoDatesInRange', () => {
  test('single day and multi-day inclusive ranges', () => {
    expect(listIsoDatesInRange('2026-08-10', '2026-08-10')).toEqual([
      '2026-08-10',
    ]);
    expect(listIsoDatesInRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});

describe('countCalendarDaysInRange', () => {
  test('inclusive span without materializing days', () => {
    expect(countCalendarDaysInRange('2026-08-10', '2026-08-10')).toBe(1);
    expect(countCalendarDaysInRange('2026-12-30', '2027-01-02')).toBe(4);
    // A full leap-adjacent year stays within the boundary limit.
    expect(countCalendarDaysInRange('2026-01-01', '2026-12-31')).toBe(365);
    expect(
      countCalendarDaysInRange('2026-01-01', '2027-01-01')
    ).toBeLessThanOrEqual(MAX_VACATION_RANGE_DAYS);
  });
});

describe('isValidIsoDate', () => {
  test('rejects rolled calendar days and accepts leap-day only in leap years', () => {
    expect(isValidIsoDate('not-a-date')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-01-00')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-03-15')).toBe(true);
  });
});

describe('formatVacationDays', () => {
  test('German day formatting incl. singular and half days', () => {
    expect(formatVacationDays(1)).toBe('1 Tag');
    expect(formatVacationDays(0.5)).toBe('0,5 Tage');
    expect(formatVacationDays(3)).toBe('3 Tage');
    expect(formatVacationDays(0)).toBe('0 Tage');
  });
});

describe('countVacationDaysByYear', () => {
  test('weekends inside the range cost nothing (full-time schedule)', () => {
    // 2026-08-06 Thursday … 2026-08-10 Monday: Thu, Fri, Mon consume.
    expect(
      countVacationDays(
        { startDate: '2026-08-06', endDate: '2026-08-10', dayPortion: 'full' },
        FULL_TIME_CONTEXT
      )
    ).toBe(3);
  });

  test('schedule-free weekdays cost nothing (part-time three-day week)', () => {
    // Mo–Fr range over a Mo/Mi/Fr schedule consumes exactly 3 days.
    expect(
      countVacationDays(
        { startDate: '2026-08-03', endDate: '2026-08-07', dayPortion: 'full' },
        {
          schedules: [makeSchedule('2026-01-01', THREE_DAY_WEEK)],
          conditions: [],
          calendar: EMPTY_HOLIDAY_CALENDAR,
        }
      )
    ).toBe(3);
  });

  test('holidays of the selected region cost nothing', () => {
    // Christi Himmelfahrt falls on Thursday 2026-05-14 and reduces the
    // Montag–Freitag week's consumed days from 5 to 4.
    const consumed = countVacationDays(
      { startDate: '2026-05-11', endDate: '2026-05-15', dayPortion: 'full' },
      {
        schedules: [makeSchedule('2026-01-01', FULL_TIME)],
        conditions: [],
        calendar: BAVARIA_CALENDAR,
      }
    );
    // Mo–Fr week containing the Thursday holiday: 4 instead of 5.
    expect(consumed).toBe(4);
  });

  test('closure days cost nothing', () => {
    const consumed = countVacationDays(
      { startDate: '2026-08-03', endDate: '2026-08-07', dayPortion: 'full' },
      {
        schedules: [makeSchedule('2026-01-01', FULL_TIME)],
        conditions: [],
        calendar: {
          ...EMPTY_HOLIDAY_CALENDAR,
          closureDays: [{ closureDate: '2026-08-05', label: 'Betriebsruhe' }],
        },
      }
    );
    expect(consumed).toBe(4);
  });

  test('labeled default source consumes only Montag–Freitag', () => {
    // No schedule, no condition: default 480 applies to all seven days for
    // overtime continuity, but vacation must only cost weekdays.
    expect(
      countVacationDays(
        { startDate: '2026-08-03', endDate: '2026-08-09', dayPortion: 'full' },
        { schedules: [], conditions: [], calendar: EMPTY_HOLIDAY_CALENDAR }
      )
    ).toBe(5);
  });

  test('derived source (condition weekly hours) spreads Montag–Freitag', () => {
    expect(
      countVacationDays(
        { startDate: '2026-08-03', endDate: '2026-08-09', dayPortion: 'full' },
        {
          schedules: [],
          conditions: [makeCondition('2026-01-01', 30, 20)],
          calendar: EMPTY_HOLIDAY_CALENDAR,
        }
      )
    ).toBe(5);
  });

  test('half day consumes 0.5 on a working day', () => {
    expect(
      countVacationDays(
        { startDate: '2026-08-10', endDate: '2026-08-10', dayPortion: 'half_day' },
        FULL_TIME_CONTEXT
      )
    ).toBe(0.5);
  });

  test('half day on a schedule-free day consumes nothing', () => {
    // 2026-08-04 is a Tuesday, schedule-free in the three-day week.
    expect(
      countVacationDays(
        { startDate: '2026-08-04', endDate: '2026-08-04', dayPortion: 'half_day' },
        {
          schedules: [makeSchedule('2026-01-01', THREE_DAY_WEEK)],
          conditions: [],
          calendar: EMPTY_HOLIDAY_CALENDAR,
        }
      )
    ).toBe(0);
  });

  test('a range crossing New Year charges each vacation year separately', () => {
    // 2026-12-30 Wed, 2026-12-31 Thu, 2027-01-01 Fri, 2027-01-02 Sat.
    const byYear = countVacationDaysByYear(
      { startDate: '2026-12-30', endDate: '2027-01-02', dayPortion: 'full' },
      FULL_TIME_CONTEXT
    );
    expect(byYear).toEqual({ '2026': 2, '2027': 1 });
  });
});

describe('absence-extended resolveDailyTarget', () => {
  const base = {
    schedules: [makeSchedule('2026-01-01', FULL_TIME)],
    conditions: [],
    calendar: EMPTY_HOLIDAY_CALENDAR,
  };
  const vacationSpan = {
    type: 'vacation' as const,
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    dayPortion: 'full' as const,
  };

  test('approved full-day vacation zeroes the target and is discriminated', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-10',
      ...base,
      absences: [vacationSpan],
    });
    expect(target.targetMinutes).toBe(0);
    expect(target.baseTargetMinutes).toBe(480);
    expect(target.absence).toEqual({ type: 'vacation', portion: 'full' });
  });

  test('half-day vacation halves the base target', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-10',
      ...base,
      absences: [{ ...vacationSpan, endDate: '2026-08-10', dayPortion: 'half_day' }],
    });
    expect(target.targetMinutes).toBe(240);
    expect(target.absence).toEqual({ type: 'vacation', portion: 'half_day' });
  });

  test('days outside the span are unaffected', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-13',
      ...base,
      absences: [vacationSpan],
    });
    expect(target.targetMinutes).toBe(480);
    expect(target.absence).toBeNull();
  });

  test('a holiday inside vacation stays a zero-target holiday', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-05-14',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar: BAVARIA_CALENDAR,
      absences: [
        {
          type: 'vacation',
          startDate: '2026-05-11',
          endDate: '2026-05-15',
          dayPortion: 'full',
        },
      ],
    });
    expect(target.isHoliday).toBe(true);
    expect(target.targetMinutes).toBe(0);
  });

  test('no absences input behaves exactly as before (additive change)', () => {
    const target = resolveDailyTarget({ dateIso: '2026-08-10', ...base });
    expect(target.targetMinutes).toBe(480);
    expect(target.absence).toBeNull();
  });
});

describe('computeVacationBalance', () => {
  const context: VacationCountingContext = {
    schedules: [makeSchedule('2026-01-01', FULL_TIME)],
    conditions: [makeCondition('2026-01-01', 30)],
    calendar: EMPTY_HOLIDAY_CALENDAR,
  };

  test('approved requests consume their approval-time snapshot', () => {
    const balance = computeVacationBalance(
      2026,
      [
        makeRequest({
          id: 'approved-1',
          status: 'approved',
          approvedDaysByYear: { '2026': 4 },
        }),
      ],
      context
    );
    expect(balance.entitlementDays).toBe(30);
    expect(balance.takenDays).toBe(4);
    expect(balance.remainingDays).toBe(26);
  });

  test('pending requests are a live preview, never taken days', () => {
    const balance = computeVacationBalance(
      2026,
      [
        makeRequest({
          id: 'pending-1',
          status: 'pending',
          startDate: '2026-08-10',
          endDate: '2026-08-11',
        }),
      ],
      context
    );
    expect(balance.takenDays).toBe(0);
    expect(balance.pendingDays).toBe(2);
    expect(balance.remainingDays).toBe(30);
  });

  test('rejected, withdrawn, and cancelled requests never consume', () => {
    const balance = computeVacationBalance(
      2026,
      [
        makeRequest({ id: 'r1', status: 'rejected' }),
        makeRequest({ id: 'r2', status: 'withdrawn' }),
        makeRequest({
          id: 'r3',
          status: 'cancelled',
          approvedDaysByYear: { '2026': 3 },
        }),
      ],
      context
    );
    expect(balance.takenDays).toBe(0);
    expect(balance.remainingDays).toBe(30);
  });

  test('snapshot survives later schedule changes (explainable balance)', () => {
    // The approval snapshot said 5 days; a retroactive schedule change to a
    // three-day week must not silently rewrite the decided balance.
    const changedContext: VacationCountingContext = {
      ...context,
      schedules: [makeSchedule('2026-01-01', THREE_DAY_WEEK)],
    };
    const balance = computeVacationBalance(
      2026,
      [
        makeRequest({
          id: 'approved-1',
          status: 'approved',
          approvedDaysByYear: { '2026': 5 },
        }),
      ],
      changedContext
    );
    expect(balance.takenDays).toBe(5);
  });

  test('no entitlement → null entitlement and null remaining, taken still real', () => {
    const balance = computeVacationBalance(
      2026,
      [
        makeRequest({
          id: 'approved-1',
          status: 'approved',
          approvedDaysByYear: { '2026': 2 },
        }),
      ],
      { ...context, conditions: [] }
    );
    expect(balance.entitlementDays).toBeNull();
    expect(balance.takenDays).toBe(2);
    expect(balance.remainingDays).toBeNull();
  });
});
