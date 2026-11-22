import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { getPublicHolidaysForYear, HOLIDAY_REGIONS, type HolidayRegion } from '@/lib/personnel/holidays';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import { berlinMonth, policyArbitrary, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';
import { resolveEmployeeDailyTargets } from './period-daily-targets';
import type { TimeAccountPolicy } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close" and "Targets", and docs/features/employee-management.md, "Work schedules and
// holidays", "Vacation", "Sickness" and "Berufsschule": a period covers the people employed in its
// month, so a day before the entry or after the exit owes nothing; the Wochenplan sets the target,
// holidays and closure days set it to 0, a full-day absence to 0 and a half day to half of it; a
// Berufsschule day counts as its normal target, so the person owes nothing more that day.

const DAY_MS = 86_400_000;

/** Monday 0 … Sunday 6 of a calendar date. */
const weekdayOf = (localDate: string): number => (new Date(`${localDate}T00:00:00Z`).getUTCDay() + 6) % 7;

const addDays = (localDate: string, days: number): string =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function monthDates(month: { start: string; end: string }): string[] {
  const dates: string[] = [];
  for (let date = month.start; date <= month.end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

const spanArbitrary = (dates: readonly string[], type: ApprovedAbsenceSpan['type']) =>
  fc
    .tuple(
      fc.constantFrom(...dates),
      fc.nat({ max: 6 }),
      fc.constantFrom('full' as const, 'half_day' as const),
    )
    .map(([startDate, days, drawnPortion]) => {
      // A Berufsschule day is always a full day (lib/personnel/school-days.ts), and a half-day
      // vacation or sickness covers one day only (lib/vacation/actions.ts, lib/sickness/actions.ts).
      const dayPortion = type === 'school' ? ('full' as const) : drawnPortion;
      return {
        type,
        startDate,
        endDate: dayPortion === 'half_day' ? startDate : addDays(startDate, days),
        dayPortion,
      };
    });

type Drawn = {
  dates: string[];
  region: HolidayRegion | null;
  weekMinutes: number[];
  entryDate: string | null;
  exitDate: string | null;
  vacations: ApprovedAbsenceSpan[];
  sickness: ApprovedAbsenceSpan[];
  school: ApprovedAbsenceSpan[];
  closures: string[];
  policy: TimeAccountPolicy | null;
};

/**
 * Ten days keep each run cheap; every rule here holds day by day. Half the windows lie around a
 * public holiday of the drawn region, so holidays meet absences and closure days often.
 */
const windowArbitrary: fc.Arbitrary<{ dates: string[]; region: HolidayRegion | null }> = fc.oneof(
  fc
    .record({
      yearMonth: yearMonthArbitrary,
      first: fc.nat({ max: 18 }),
      region: fc.option(fc.constantFrom(...HOLIDAY_REGIONS), { nil: null }),
    })
    .map(({ yearMonth: { year, month }, first, region }) => ({
      dates: monthDates(berlinMonth(year, month)).slice(first, first + 10),
      region,
    })),
  fc
    .record({
      // From 2001 on, so a window that starts before its holiday still lies in the Wochenplan.
      year: fc.integer({ min: 2001, max: 2098 }),
      region: fc.constantFrom(...HOLIDAY_REGIONS),
      back: fc.nat({ max: 9 }),
      pick: fc.nat(),
    })
    .map(({ year, region, back, pick }) => {
      const holidays = getPublicHolidaysForYear(region, year);
      const first = addDays(holidays[pick % holidays.length]?.date ?? `${year}-01-01`, -back);
      return { dates: Array.from({ length: 10 }, (_, day) => addDays(first, day)), region };
    }),
);

const treatmentArbitrary = fc.constantFrom('paid' as const, 'unpaid' as const, 'informational' as const);

const periodArbitrary: fc.Arbitrary<Drawn> = windowArbitrary.chain(({ dates, region }) => {
  const optionalDate = fc.option(fc.constantFrom(...dates), { nil: null });
  return fc.record({
    dates: fc.constant(dates),
    region: fc.constant(region),
    weekMinutes: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 60, max: 600 })), {
      minLength: 7,
      maxLength: 7,
    }),
    entryDate: optionalDate,
    exitDate: optionalDate,
    vacations: fc.array(spanArbitrary(dates, 'vacation'), { maxLength: 2 }),
    sickness: fc.array(spanArbitrary(dates, 'sickness'), { maxLength: 2 }),
    school: fc.array(spanArbitrary(dates, 'school'), { maxLength: 3 }),
    closures: fc.subarray(dates, { maxLength: 3 }),
    // Vacation and sickness each get their own treatment, so one can be informational alone.
    policy: fc.option(
      fc
        .tuple(policyArbitrary, treatmentArbitrary)
        .map(([policy, sicknessTreatment]) => ({ ...policy, sicknessTreatment })),
      { nil: null },
    ),
  });
});

/** The arguments of one person's daily targets for the drawn days. */
function argumentsFor(drawn: Drawn): Parameters<typeof resolveEmployeeDailyTargets> {
  const id = 'record-1';
  return [
    { id, entry_date: drawn.entryDate, exit_date: drawn.exitDate },
    new Map(drawn.dates.map((date) => [date, drawn.policy])),
    {
      sources: {
        schedules: [
          {
            id: 'schedule-1',
            organization_id: 'org-1',
            employee_record_id: id,
            valid_from: '2000-01-01',
            note: null,
            created_by: null,
            created_at: '2000-01-01T00:00:00Z',
            updated_at: '2000-01-01T00:00:00Z',
            monday_minutes: drawn.weekMinutes[0] ?? 0,
            tuesday_minutes: drawn.weekMinutes[1] ?? 0,
            wednesday_minutes: drawn.weekMinutes[2] ?? 0,
            thursday_minutes: drawn.weekMinutes[3] ?? 0,
            friday_minutes: drawn.weekMinutes[4] ?? 0,
            saturday_minutes: drawn.weekMinutes[5] ?? 0,
            sunday_minutes: drawn.weekMinutes[6] ?? 0,
          },
        ],
        conditions: [],
        vacations: new Map([[id, drawn.vacations]]),
        sickness: new Map([[id, drawn.sickness]]),
        school: new Map([[id, drawn.school]]),
        calendar: {
          holidayRegion: drawn.region,
          holidayRegionHistory: [],
          closureDays: drawn.closures.map((closureDate) => ({ closureDate, label: null })),
        },
      },
      index: { dates: drawn.dates },
    },
  ];
}

const employed = (drawn: Drawn, date: string): boolean =>
  (drawn.entryDate === null || drawn.entryDate <= date) &&
  (drawn.exitDate === null || date <= drawn.exitDate);

const covering = (spans: readonly ApprovedAbsenceSpan[], date: string): ApprovedAbsenceSpan[] =>
  spans.filter((span) => span.startDate <= date && date <= span.endDate);

const isSchoolDay = (spans: readonly ApprovedAbsenceSpan[], date: string): boolean =>
  covering(spans, date).length > 0;

/** The Wochenplan minutes of a date. */
const planOf = (drawn: Drawn, date: string): number => drawn.weekMinutes[weekdayOf(date)] ?? 0;

/** Whether the drawn region keeps a public holiday on the date. */
const isHoliday = (drawn: Drawn, date: string): boolean =>
  drawn.region !== null &&
  getPublicHolidaysForYear(drawn.region, Number(date.slice(0, 4))).some((holiday) => holiday.date === date);

const isDayOff = (drawn: Drawn, date: string): boolean =>
  isHoliday(drawn, date) || drawn.closures.includes(date);

const treatmentOf = (drawn: Drawn, type: ApprovedAbsenceSpan['type']) =>
  type === 'vacation'
    ? drawn.policy?.vacationTreatment
    : type === 'sickness'
      ? drawn.policy?.sicknessTreatment
      : undefined;

/**
 * werk-flow/werkflow-planning#523: a vacation or sickness the policy counts as informational brings
 * the Wochenplan target of a holiday or closure day back. The known-bug case below holds that class.
 * The absence that applies is the one lib/personnel/targets.ts attributes the day to: a full-day
 * span over a half day, then vacation, then sickness, then a school day that falls on a workday.
 */
function informationalOnDayOff(drawn: Drawn, date: string): boolean {
  if (!isDayOff(drawn, date) || !employed(drawn, date) || planOf(drawn, date) === 0) return false;
  const spans = covering([...drawn.vacations, ...drawn.sickness, ...drawn.school], date);
  const full = spans.filter((span) => span.dayPortion === 'full');
  const strongest = full.length > 0 ? full : spans;
  const applies =
    strongest.find((span) => span.type === 'vacation') ??
    strongest.find((span) => span.type === 'sickness') ??
    strongest[0];
  return applies !== undefined && treatmentOf(drawn, applies.type) === 'informational';
}

/**
 * The Soll a day may have, or null where no spec sentence fixes it: under several absences at once,
 * and under an absence the policy counts as informational, which the specs do not name.
 */
function allowedTargets(drawn: Drawn, date: string): number[] | null {
  const plan = planOf(drawn, date);
  if (!employed(drawn, date)) return [0];
  if (isDayOff(drawn, date)) return informationalOnDayOff(drawn, date) ? null : [0];
  if (isSchoolDay(drawn.school, date) && plan > 0) return [0];
  const absences = covering([...drawn.vacations, ...drawn.sickness], date);
  const [absence] = absences;
  if (!absence) return [plan];
  if (absences.length > 1 || treatmentOf(drawn, absence.type) === 'informational') return null;
  return absence.dayPortion === 'full' ? [0] : [Math.floor(plan / 2), Math.ceil(plan / 2)];
}

describe('The daily targets of a period', () => {
  test('give every day one row with the Wochenplan as its source', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        const days = resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets;
        expect(days.map((day) => day.localDate)).toEqual(drawn.dates);
        for (const day of days) expect(day.source).toBe('schedule');
      }),
    );
  });

  test('owe the Wochenplan on a workday, nothing on a holiday or closure day, half or none under an absence', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        for (const day of resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets) {
          const allowed = allowedTargets(drawn, day.localDate);
          if (allowed) expect(allowed).toContain(day.targetMinutes);
        }
      }),
    );
  });

  test('owe nothing and credit nothing on a day before the entry or after the exit', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        for (const day of resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets.filter(
          (target) => !employed(drawn, target.localDate),
        ))
          expect([day.targetMinutes, day.vacationMinutes, day.sicknessMinutes, day.schoolMinutes]).toEqual([
            0, 0, 0, 0,
          ]);
      }),
    );
  });

  test('credit a working Berufsschule day without other absence with its full Wochenplan target, a holiday or closure day nothing', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        for (const day of resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets) {
          const plan = drawn.weekMinutes[weekdayOf(day.localDate)] ?? 0;
          const otherAbsence = isSchoolDay([...drawn.vacations, ...drawn.sickness], day.localDate);
          if (
            isSchoolDay(drawn.school, day.localDate) &&
            !otherAbsence &&
            employed(drawn, day.localDate) &&
            !isDayOff(drawn, day.localDate)
          )
            expect(day.schoolMinutes).toBe(plan);
          // A holiday or closure day keeps its own rule, also under an informational absence
          // (werk-flow/werkflow-planning#523 concerns its Soll only).
          if (!isSchoolDay(drawn.school, day.localDate) || isDayOff(drawn, day.localDate))
            expect(day.schoolMinutes).toBe(0);
        }
      }),
    );
  });

  test('owe nothing on a Berufsschule workday, and change no other day for it', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        const withSchool = resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets;
        const without = resolveEmployeeDailyTargets(...argumentsFor({ ...drawn, school: [] })).dailyTargets;
        for (const [index, day] of withSchool.entries()) {
          if (!isSchoolDay(drawn.school, day.localDate)) expect(day).toEqual(without[index] ?? day);
          else if (!informationalOnDayOff(drawn, day.localDate)) expect(day.targetMinutes).toBe(0);
        }
      }),
    );
  });

  // known bug: werk-flow/werkflow-planning#523 an informational sickness brings a closure day's Wochenplan target back
  test.failing('owe nothing on a closure day an informational sickness covers', () => {
    const policy: TimeAccountPolicy = {
      id: 'policy-a',
      version: 1,
      effectiveFrom: '2000-01-01',
      creditRules: [],
      supplementRules: [],
      nightWindow: null,
      vacationTreatment: 'paid',
      sicknessTreatment: 'informational',
      warningRules: [],
    };
    const drawn: Drawn = {
      dates: ['2026-12-23', '2026-12-24'],
      region: null,
      weekMinutes: [480, 480, 480, 480, 480, 0, 0],
      entryDate: null,
      exitDate: null,
      vacations: [],
      sickness: [{ type: 'sickness', startDate: '2026-12-24', endDate: '2026-12-24', dayPortion: 'full' }],
      school: [],
      closures: ['2026-12-24'],
      policy,
    };
    const [, closureDay] = resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets;
    expect(closureDay?.targetMinutes).toBe(0);
  });
});
