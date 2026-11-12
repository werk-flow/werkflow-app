import { describe, expect, test } from 'bun:test';

import { groupSchoolDaySpansByRecord, type SchoolDay } from '@/lib/personnel/school-days';
import {
  EMPTY_HOLIDAY_CALENDAR,
  type ApprovedAbsenceSpan,
  type OrganizationHolidayCalendar,
} from '@/lib/personnel/targets';
import { calculateEmployeePeriod } from './calculation';
import { resolveEmployeeDailyTargets } from './period-daily-targets';
import type { TimeAccountPolicy } from './types';

// The owner's rule for Berufsschule days (werk-flow/werkflow-planning#14):
// a school day is credited with the day's normal target. On the Zeitkonto an
// apprentice neither gains nor loses on it, time recorded on it counts on
// top, and a holiday or a vacation on it is not credited a second time.

const APPRENTICE = { id: 'apprentice-1', entry_date: null, exit_date: null };

const eightHourWeek = {
  id: 'schedule-1',
  organization_id: 'org-1',
  employee_record_id: APPRENTICE.id,
  valid_from: '2026-01-01',
  monday_minutes: 480,
  tuesday_minutes: 480,
  wednesday_minutes: 480,
  thursday_minutes: 480,
  friday_minutes: 480,
  saturday_minutes: 0,
  sunday_minutes: 0,
  note: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const policy: TimeAccountPolicy = {
  id: 'policy-1',
  version: 1,
  effectiveFrom: '2026-01-01',
  vacationTreatment: 'paid',
  sicknessTreatment: 'paid',
  warningRules: [],
  nightWindow: null,
  creditRules: [{ activityKind: 'work', percentage: 100 }],
  supplementRules: [],
};

/** A weekly school day on Fridays from 01.09.2026. */
const fridaySchool: SchoolDay = {
  id: 'school-1',
  employeeRecordId: APPRENTICE.id,
  kind: 'weekday',
  weekday: 4,
  startDate: '2026-09-01',
  endDate: null,
  cancelledAt: null,
};

function closeDay(input: {
  date: string;
  schoolDays?: SchoolDay[];
  vacations?: ApprovedAbsenceSpan[];
  calendar?: OrganizationHolidayCalendar;
  workedFrom?: string;
  workedUntil?: string;
}) {
  const { date } = input;
  const { resolvedTargets, dailyTargets } = resolveEmployeeDailyTargets(APPRENTICE, new Map(), {
    sources: {
      schedules: [eightHourWeek],
      conditions: [],
      vacations: new Map([[APPRENTICE.id, input.vacations ?? []]]),
      sickness: new Map(),
      school: groupSchoolDaySpansByRecord(input.schoolDays ?? [], date, date),
      calendar: input.calendar ?? EMPTY_HOLIDAY_CALENDAR,
    },
    index: { dates: [date] },
  });
  const calculation = calculateEmployeePeriod({
    employeeRecordId: APPRENTICE.id,
    periodStart: date,
    periodEnd: date,
    previousBalanceMinutes: 0,
    policy,
    publicHolidayDates: new Set(
      resolvedTargets.filter((target) => target.isHoliday).map((target) => target.date),
    ),
    dailyTargets,
    accountEvents: [],
    activityIntervals:
      input.workedFrom && input.workedUntil
        ? [
            {
              sourceId: 'work-1',
              activityKind: 'work',
              startedAt: input.workedFrom,
              endedAt: input.workedUntil,
            },
          ]
        : [],
  });
  return { calculation, schoolMinutes: dailyTargets.reduce((sum, day) => sum + day.schoolMinutes, 0) };
}

describe('a Berufsschule day on the Zeitkonto', () => {
  // Friday 06.11.2026.
  const schoolFriday = '2026-11-06';

  test('without a school day, a day without recorded time costs the full target', () => {
    expect(closeDay({ date: schoolFriday }).calculation.closingBalanceMinutes).toBe(-480);
  });

  test('a school day without recorded time ends with a balance of 0, not minus the target', () => {
    const { calculation, schoolMinutes } = closeDay({ date: schoolFriday, schoolDays: [fridaySchool] });
    expect(calculation.closingBalanceMinutes).toBe(0);
    expect(schoolMinutes).toBe(480);
  });

  test('time recorded on a school day counts on top', () => {
    // 14:00 to 16:00 Berlin (CET) after school.
    const { calculation } = closeDay({
      date: schoolFriday,
      schoolDays: [fridaySchool],
      workedFrom: '2026-11-06T13:00:00.000Z',
      workedUntil: '2026-11-06T15:00:00.000Z',
    });
    expect(calculation.closingBalanceMinutes).toBe(120);
  });

  test('a school day on a public holiday is not credited twice', () => {
    // Christmas Day 2026 is a Friday.
    const calendar: OrganizationHolidayCalendar = {
      holidayRegion: 'BY',
      holidayRegionHistory: [{ region: 'BY', effectiveFrom: '2026-01-01T08:00:00Z' }],
      closureDays: [],
    };
    const { calculation, schoolMinutes } = closeDay({
      date: '2026-12-25',
      schoolDays: [fridaySchool],
      calendar,
    });
    expect(calculation.closingBalanceMinutes).toBe(0);
    expect(schoolMinutes).toBe(0);
  });

  test('a school day in a vacation is not credited twice', () => {
    const { calculation, schoolMinutes } = closeDay({
      date: schoolFriday,
      schoolDays: [fridaySchool],
      vacations: [{ type: 'vacation', startDate: schoolFriday, endDate: schoolFriday, dayPortion: 'full' }],
    });
    expect(calculation.closingBalanceMinutes).toBe(0);
    expect(calculation.vacationMinutes).toBe(480);
    expect(schoolMinutes).toBe(0);
  });

  test('an informational absence policy never takes back a school day', () => {
    const informational = new Map([
      [
        schoolFriday,
        {
          ...policy,
          vacationTreatment: 'informational' as const,
          sicknessTreatment: 'informational' as const,
        },
      ],
    ]);
    const { dailyTargets } = resolveEmployeeDailyTargets(APPRENTICE, informational, {
      sources: {
        schedules: [eightHourWeek],
        conditions: [],
        vacations: new Map(),
        sickness: new Map(),
        school: groupSchoolDaySpansByRecord([fridaySchool], schoolFriday, schoolFriday),
        calendar: EMPTY_HOLIDAY_CALENDAR,
      },
      index: { dates: [schoolFriday] },
    });
    expect(dailyTargets.map((day) => day.targetMinutes)).toEqual([0]);
  });
});
