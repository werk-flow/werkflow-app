import { describe, expect, test } from 'bun:test';

import type { EmploymentCondition } from './types';
import type { WorkSchedule } from './schedule';
import { getBusinessWeekDates, getWeekdayIndex } from './schedule';
import {
  DEFAULT_DAILY_TARGET_MINUTES,
  EMPTY_HOLIDAY_CALENDAR,
  resolveDailyTarget,
  resolveHolidayRegionOnDate,
  sumTargetMinutes,
  resolveDailyTargets,
  type OrganizationHolidayCalendar,
} from './targets';

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
  weeklyHours: number | null
): EmploymentCondition {
  return {
    id: `condition-${validFrom}`,
    organizationId: 'org-1',
    employeeRecordId: 'record-1',
    validFrom,
    employmentType: 'teilzeit',
    weeklyHours,
    vacationDaysPerYear: null,
    note: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const FULL_TIME = [480, 480, 480, 480, 480, 0, 0];
const PART_TIME = [240, 240, 240, 240, 240, 0, 0];

describe('resolveDailyTarget — schedule source', () => {
  test('full-time weekday target comes from the schedule', () => {
    // 2026-08-04 is a Tuesday.
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(target.source).toBe('schedule');
    expect(target.targetMinutes).toBe(480);
    expect(target.weekday).toBe(1);
  });

  test('part-time and weekend days resolve per weekday', () => {
    const schedules = [makeSchedule('2026-01-01', PART_TIME)];
    const tuesday = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    // 2026-08-08 is a Saturday.
    const saturday = resolveDailyTarget({
      dateIso: '2026-08-08',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(tuesday.targetMinutes).toBe(240);
    expect(saturday.targetMinutes).toBe(0);
    expect(saturday.source).toBe('schedule');
  });

  test('a date-effective change never alters historical days', () => {
    const schedules = [
      makeSchedule('2026-01-01', FULL_TIME),
      makeSchedule('2026-08-05', PART_TIME),
    ];
    const before = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    const onChange = resolveDailyTarget({
      dateIso: '2026-08-05',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(before.targetMinutes).toBe(480);
    expect(onChange.targetMinutes).toBe(240);
  });

  test('a future-dated schedule is not effective yet: fallback applies', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [makeSchedule('2026-09-01', FULL_TIME)],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(target.source).toBe('default');
  });
});

describe('resolveDailyTarget — fallback cascade', () => {
  test('derived source spreads condition weekly hours across Mo–Fr', () => {
    const conditions = [makeCondition('2026-01-01', 30)];
    const tuesday = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    const saturday = resolveDailyTarget({
      dateIso: '2026-08-08',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(tuesday.source).toBe('derived');
    expect(tuesday.targetMinutes).toBe(360);
    expect(saturday.targetMinutes).toBe(0);
  });

  test('derived source uses the condition effective on the date', () => {
    const conditions = [
      makeCondition('2026-01-01', 40),
      makeCondition('2026-08-05', 20),
    ];
    const before = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    const after = resolveDailyTarget({
      dateIso: '2026-08-05',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(before.targetMinutes).toBe(480);
    expect(after.targetMinutes).toBe(240);
  });

  test('default source is the labeled legacy 480 on every day', () => {
    const tuesday = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    const saturday = resolveDailyTarget({
      dateIso: '2026-08-08',
      schedules: [],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });
    expect(tuesday.source).toBe('default');
    expect(tuesday.targetMinutes).toBe(DEFAULT_DAILY_TARGET_MINUTES);
    // Exactly the pre-P1-04 behavior: 480 also on weekend days with work.
    expect(saturday.targetMinutes).toBe(DEFAULT_DAILY_TARGET_MINUTES);
  });
});

describe('resolveDailyTarget — holidays and closure days', () => {
  const bavarianCalendar: OrganizationHolidayCalendar = {
    holidayRegion: 'BY',
    holidayRegionHistory: [
      { region: 'BY', effectiveFrom: '2026-01-01T08:00:00Z' },
    ],
    closureDays: [],
  };

  test('a regional holiday zeroes the target but keeps the base', () => {
    // Fronleichnam 2026-06-04 is a Thursday.
    const target = resolveDailyTarget({
      dateIso: '2026-06-04',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar: bavarianCalendar,
    });
    expect(target.isHoliday).toBe(true);
    expect(target.holidayName).toBe('Fronleichnam');
    expect(target.targetMinutes).toBe(0);
    expect(target.baseTargetMinutes).toBe(480);
  });

  test('a holiday of another region does not apply', () => {
    // Reformationstag is not a Bavarian holiday.
    const target = resolveDailyTarget({
      dateIso: '2026-10-31',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar: bavarianCalendar,
    });
    expect(target.isHoliday).toBe(false);
  });

  test('holidays only apply from the region selection onward', () => {
    const calendar: OrganizationHolidayCalendar = {
      holidayRegion: 'BY',
      holidayRegionHistory: [
        { region: 'BY', effectiveFrom: '2026-08-01T08:00:00Z' },
      ],
      closureDays: [],
    };
    // Fronleichnam was before the selection: the day keeps its target.
    const target = resolveDailyTarget({
      dateIso: '2026-06-04',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar,
    });
    expect(target.isHoliday).toBe(false);
    expect(target.targetMinutes).toBe(480);
  });

  test('a closure day zeroes the target for any source', () => {
    const calendar: OrganizationHolidayCalendar = {
      holidayRegion: null,
      holidayRegionHistory: [],
      closureDays: [{ closureDate: '2026-08-04', label: 'Betriebsausflug' }],
    };
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [],
      conditions: [],
      calendar,
    });
    expect(target.isClosureDay).toBe(true);
    expect(target.closureLabel).toBe('Betriebsausflug');
    expect(target.targetMinutes).toBe(0);
    expect(target.source).toBe('default');
  });
});

describe('resolveHolidayRegionOnDate', () => {
  test('without history the current selection applies', () => {
    expect(
      resolveHolidayRegionOnDate(
        { holidayRegion: 'NW', holidayRegionHistory: [] },
        '2026-08-04'
      )
    ).toBe('NW');
  });

  test('a region change resolves per date', () => {
    const history = [
      { region: 'BY', effectiveFrom: '2026-01-10T08:00:00Z' },
      { region: 'NW', effectiveFrom: '2026-06-01T08:00:00Z' },
    ];
    const calendar = { holidayRegion: 'NW', holidayRegionHistory: history };
    expect(resolveHolidayRegionOnDate(calendar, '2026-01-05')).toBeNull();
    expect(resolveHolidayRegionOnDate(calendar, '2026-03-01')).toBe('BY');
    expect(resolveHolidayRegionOnDate(calendar, '2026-08-04')).toBe('NW');
  });
});

describe('week helpers', () => {
  test('getWeekdayIndex is Monday-first', () => {
    expect(getWeekdayIndex('2026-08-03')).toBe(0); // Monday
    expect(getWeekdayIndex('2026-08-09')).toBe(6); // Sunday
  });

  test('getBusinessWeekDates returns Monday–Sunday of the Berlin week', () => {
    // 2026-08-05 12:00 UTC is a Wednesday in Berlin.
    const dates = getBusinessWeekDates(new Date('2026-08-05T12:00:00Z'));
    expect(dates).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
  });

  test('sumTargetMinutes sums a week of mixed sources', () => {
    const targets = resolveDailyTargets(
      getBusinessWeekDates(new Date('2026-08-05T12:00:00Z')),
      {
        schedules: [
          makeSchedule('2026-01-01', FULL_TIME),
          makeSchedule('2026-08-06', PART_TIME),
        ],
        conditions: [],
        calendar: EMPTY_HOLIDAY_CALENDAR,
      }
    );
    // Mo–Mi full time (3 × 480), Do–Fr part time (2 × 240), weekend 0.
    expect(sumTargetMinutes(targets)).toBe(3 * 480 + 2 * 240);
  });
});
