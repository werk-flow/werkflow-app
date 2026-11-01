import { describe, expect, test } from 'bun:test';

import type { EmploymentCondition } from './types';
import type { WorkSchedule } from './schedule';
import { getBusinessWeekDates, getWeekdayIndex } from './schedule';
import {
  DEFAULT_DAILY_TARGET_MINUTES,
  EMPTY_HOLIDAY_CALENDAR,
  getNoTargetReason,
  getTargetSourceHint,
  resolveDailyTarget,
  resolveHolidayRegionOnDate,
  sumTargetMinutes,
  resolveDailyTargets,
  type EmploymentInterval,
  type OrganizationHolidayCalendar,
} from './targets';

function makeSchedule(validFrom: string, dayMinutes: number[], id = `schedule-${validFrom}`): WorkSchedule {
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

function makeCondition(validFrom: string, weeklyHours: number | null): EmploymentCondition {
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

const OPEN_EMPLOYMENT: EmploymentInterval = { entryDate: null, exitDate: null };

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
      employment: OPEN_EMPLOYMENT,
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
      employment: OPEN_EMPLOYMENT,
    });
    // 2026-08-08 is a Saturday.
    const saturday = resolveDailyTarget({
      dateIso: '2026-08-08',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    expect(tuesday.targetMinutes).toBe(240);
    expect(saturday.targetMinutes).toBe(0);
    expect(saturday.source).toBe('schedule');
  });

  test('a date-effective change never alters historical days', () => {
    const schedules = [makeSchedule('2026-01-01', FULL_TIME), makeSchedule('2026-08-05', PART_TIME)];
    const before = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    const onChange = resolveDailyTarget({
      dateIso: '2026-08-05',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
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
      employment: OPEN_EMPLOYMENT,
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
      employment: OPEN_EMPLOYMENT,
    });
    const saturday = resolveDailyTarget({
      dateIso: '2026-08-08',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    expect(tuesday.source).toBe('derived');
    expect(tuesday.targetMinutes).toBe(360);
    expect(saturday.targetMinutes).toBe(0);
  });

  test('derived source uses the condition effective on the date', () => {
    const conditions = [makeCondition('2026-01-01', 40), makeCondition('2026-08-05', 20)];
    const before = resolveDailyTarget({
      dateIso: '2026-08-04',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    const after = resolveDailyTarget({
      dateIso: '2026-08-05',
      schedules: [],
      conditions,
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    expect(before.targetMinutes).toBe(480);
    expect(after.targetMinutes).toBe(240);
  });

  // werk-flow/werkflow-planning#81: an unconfigured person owed 8 h on
  // Saturday and Sunday too, a 56-hour week.
  test('default source is the labeled 480 on Montag–Freitag and nothing on the weekend', () => {
    const week = resolveDailyTargets(getBusinessWeekDates(new Date('2026-08-05T12:00:00Z')), {
      schedules: [],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    expect(week.map((target) => target.source)).toEqual(Array(7).fill('default'));
    expect(week.map((target) => target.targetMinutes)).toEqual([480, 480, 480, 480, 480, 0, 0]);
    expect(sumTargetMinutes(week)).toBe(5 * DEFAULT_DAILY_TARGET_MINUTES);
  });
});

// werk-flow/werkflow-planning#79: the target ran on after the exit date, so the
// Plantafel, the week's Soll and the period's Soll counted days of a person who
// had left.
describe('resolveDailyTarget — employment interval', () => {
  const schedules = [makeSchedule('2026-01-01', FULL_TIME)];
  const employment: EmploymentInterval = { entryDate: '2026-08-04', exitDate: '2026-08-06' };
  const resolveOn = (dateIso: string) =>
    resolveDailyTarget({ dateIso, schedules, conditions: [], calendar: EMPTY_HOLIDAY_CALENDAR, employment });

  test('the exit date is the last day with a target', () => {
    // 2026-08-06 is a Thursday, 2026-08-07 a Friday.
    expect(resolveOn('2026-08-06').targetMinutes).toBe(480);
    expect(resolveOn('2026-08-06').outsideEmployment).toBeNull();
    const dayAfterExit = resolveOn('2026-08-07');
    expect(dayAfterExit.targetMinutes).toBe(0);
    expect(dayAfterExit.baseTargetMinutes).toBe(0);
    expect(dayAfterExit.outsideEmployment).toBe('after_exit');
  });

  test('the entry date is the first day with a target', () => {
    const dayBeforeEntry = resolveOn('2026-08-03');
    expect(dayBeforeEntry.targetMinutes).toBe(0);
    expect(dayBeforeEntry.baseTargetMinutes).toBe(0);
    expect(dayBeforeEntry.outsideEmployment).toBe('before_entry');
    expect(resolveOn('2026-08-04').targetMinutes).toBe(480);
  });

  test('an absence after the exit date brings back no base target', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-07',
      schedules,
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment,
      absences: [{ type: 'vacation', startDate: '2026-08-07', endDate: '2026-08-07', dayPortion: 'full' }],
    });
    expect(target.baseTargetMinutes).toBe(0);
    expect(target.targetMinutes).toBe(0);
  });

  test('an unconfigured person after the exit date shows no missing-configuration hint', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-07',
      schedules: [],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment,
    });
    expect(target.source).toBe('default');
    expect(getTargetSourceHint(target)).toBeNull();
  });
});

describe('getNoTargetReason', () => {
  const base = {
    schedules: [makeSchedule('2026-01-01', FULL_TIME)],
    conditions: [],
    calendar: EMPTY_HOLIDAY_CALENDAR,
    employment: OPEN_EMPLOYMENT,
  };

  test('a day with a target has no reason', () => {
    expect(getNoTargetReason(resolveDailyTarget({ dateIso: '2026-08-04', ...base }))).toBeNull();
  });

  test('employment outranks every other reason', () => {
    const employment: EmploymentInterval = { entryDate: '2026-08-05', exitDate: '2026-08-06' };
    const closure: OrganizationHolidayCalendar = {
      ...EMPTY_HOLIDAY_CALENDAR,
      closureDays: [{ closureDate: '2026-08-07', label: 'Inventur' }],
    };
    expect(getNoTargetReason(resolveDailyTarget({ dateIso: '2026-08-04', ...base, employment }))).toBe(
      'Noch nicht eingetreten',
    );
    expect(
      getNoTargetReason(
        resolveDailyTarget({ dateIso: '2026-08-07', ...base, calendar: closure, employment }),
      ),
    ).toBe('Ausgeschieden');
  });

  test('a closure day, an absence and a free schedule day name themselves', () => {
    const closure: OrganizationHolidayCalendar = {
      ...EMPTY_HOLIDAY_CALENDAR,
      closureDays: [{ closureDate: '2026-08-04', label: 'Inventur' }],
    };
    expect(getNoTargetReason(resolveDailyTarget({ dateIso: '2026-08-04', ...base, calendar: closure }))).toBe(
      'Betriebsruhe (Inventur)',
    );
    const sickness = resolveDailyTarget({
      dateIso: '2026-08-04',
      ...base,
      absences: [{ type: 'sickness', startDate: '2026-08-04', endDate: '2026-08-04', dayPortion: 'full' }],
    });
    expect(getNoTargetReason(sickness)).toBe('Krankmeldung');
    expect(getNoTargetReason(resolveDailyTarget({ dateIso: '2026-08-08', ...base }))).toBe(
      'Kein Arbeitstag laut Wochenplan',
    );
  });

  test('an unconfigured person rests on the weekend, not by a Wochenplan', () => {
    const saturday = resolveDailyTarget({ dateIso: '2026-08-08', ...base, schedules: [] });
    expect(getNoTargetReason(saturday)).toBe('Wochenende');
  });
});

describe('resolveDailyTarget — holidays and closure days', () => {
  const bavarianCalendar: OrganizationHolidayCalendar = {
    holidayRegion: 'BY',
    holidayRegionHistory: [{ region: 'BY', effectiveFrom: '2026-01-01T08:00:00Z' }],
    closureDays: [],
  };

  test('a regional holiday zeroes the target but keeps the base', () => {
    // Fronleichnam 2026-06-04 is a Thursday.
    const target = resolveDailyTarget({
      dateIso: '2026-06-04',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar: bavarianCalendar,
      employment: OPEN_EMPLOYMENT,
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
      employment: OPEN_EMPLOYMENT,
    });
    expect(target.isHoliday).toBe(false);
  });

  test('holidays only apply from the region selection onward', () => {
    const calendar: OrganizationHolidayCalendar = {
      holidayRegion: 'BY',
      holidayRegionHistory: [{ region: 'BY', effectiveFrom: '2026-08-01T08:00:00Z' }],
      closureDays: [],
    };
    // Fronleichnam was before the selection: the day keeps its target.
    const target = resolveDailyTarget({
      dateIso: '2026-06-04',
      schedules: [makeSchedule('2026-01-01', FULL_TIME)],
      conditions: [],
      calendar,
      employment: OPEN_EMPLOYMENT,
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
      employment: OPEN_EMPLOYMENT,
    });
    expect(target.isClosureDay).toBe(true);
    expect(target.closureLabel).toBe('Betriebsausflug');
    expect(target.targetMinutes).toBe(0);
    expect(target.source).toBe('default');
  });
});

describe('resolveHolidayRegionOnDate', () => {
  test('without history the current selection applies', () => {
    expect(resolveHolidayRegionOnDate({ holidayRegion: 'NW', holidayRegionHistory: [] }, '2026-08-04')).toBe(
      'NW',
    );
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
    const targets = resolveDailyTargets(getBusinessWeekDates(new Date('2026-08-05T12:00:00Z')), {
      schedules: [makeSchedule('2026-01-01', FULL_TIME), makeSchedule('2026-08-06', PART_TIME)],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: OPEN_EMPLOYMENT,
    });
    // Mo–Mi full time (3 × 480), Do–Fr part time (2 × 240), weekend 0.
    expect(sumTargetMinutes(targets)).toBe(3 * 480 + 2 * 240);
  });
});

describe('resolveDailyTarget — sickness absence (P1-08)', () => {
  // 2026-08-04 is a Tuesday with a 480-minute schedule target.
  const base = {
    schedules: [makeSchedule('2026-01-01', FULL_TIME)],
    conditions: [],
    calendar: EMPTY_HOLIDAY_CALENDAR,
    employment: OPEN_EMPLOYMENT,
  };

  test('a full-day sickness span zeroes the target', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      ...base,
      absences: [
        {
          type: 'sickness',
          startDate: '2026-08-03',
          endDate: '2026-08-05',
          dayPortion: 'full',
        },
      ],
    });
    expect(target.targetMinutes).toBe(0);
    expect(target.baseTargetMinutes).toBe(480);
    expect(target.absence).toEqual({ type: 'sickness', portion: 'full' });
  });

  test('a half-day sickness span halves the base target', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      ...base,
      absences: [
        {
          type: 'sickness',
          startDate: '2026-08-04',
          endDate: '2026-08-04',
          dayPortion: 'half_day',
        },
      ],
    });
    expect(target.targetMinutes).toBe(240);
    expect(target.absence).toEqual({ type: 'sickness', portion: 'half_day' });
  });

  test('holiday zeroing stays first: sickness on a holiday changes nothing', () => {
    const calendar: OrganizationHolidayCalendar = {
      holidayRegion: 'BY',
      holidayRegionHistory: [{ region: 'BY', effectiveFrom: '2025-01-01T00:00:00Z' }],
      closureDays: [],
    };
    // 2026-01-06 Heilige Drei Könige (BY), a Tuesday.
    const target = resolveDailyTarget({
      dateIso: '2026-01-06',
      schedules: [makeSchedule('2025-01-01', FULL_TIME)],
      conditions: [],
      calendar,
      employment: OPEN_EMPLOYMENT,
      absences: [
        {
          type: 'sickness',
          startDate: '2026-01-06',
          endDate: '2026-01-06',
          dayPortion: 'full',
        },
      ],
    });
    expect(target.isHoliday).toBe(true);
    expect(target.targetMinutes).toBe(0);
  });

  test('a full-day sickness is never weakened by a half-day vacation on the same day', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      ...base,
      absences: [
        {
          type: 'vacation',
          startDate: '2026-08-04',
          endDate: '2026-08-04',
          dayPortion: 'half_day',
        },
        {
          type: 'sickness',
          startDate: '2026-08-04',
          endDate: '2026-08-04',
          dayPortion: 'full',
        },
      ],
    });
    // Any full-day span makes the day fully absent; the attribution follows
    // the strongest coverage, not the span order.
    expect(target.targetMinutes).toBe(0);
    expect(target.absence).toEqual({ type: 'sickness', portion: 'full' });
  });

  test('a day covered by vacation and sickness keeps the vacation attribution', () => {
    const target = resolveDailyTarget({
      dateIso: '2026-08-04',
      ...base,
      absences: [
        {
          type: 'sickness',
          startDate: '2026-08-04',
          endDate: '2026-08-06',
          dayPortion: 'full',
        },
        {
          type: 'vacation',
          startDate: '2026-08-03',
          endDate: '2026-08-04',
          dayPortion: 'full',
        },
      ],
    });
    // Deterministic precedence regardless of span order: vacation wins the
    // display attribution; the target is 0 either way.
    expect(target.targetMinutes).toBe(0);
    expect(target.absence).toEqual({ type: 'vacation', portion: 'full' });
  });

  test('sickness before its start date and after its end date has no effect', () => {
    const span = {
      type: 'sickness' as const,
      startDate: '2026-08-04',
      endDate: '2026-08-05',
      dayPortion: 'full' as const,
    };
    expect(resolveDailyTarget({ dateIso: '2026-08-03', ...base, absences: [span] }).targetMinutes).toBe(480);
    expect(resolveDailyTarget({ dateIso: '2026-08-06', ...base, absences: [span] }).targetMinutes).toBe(480);
  });
});
