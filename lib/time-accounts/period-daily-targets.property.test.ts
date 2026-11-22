import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import { berlinMonth, policyArbitrary, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';
import { resolveEmployeeDailyTargets } from './period-daily-targets';
import type { TimeAccountPolicy } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close" and "Targets": a period covers the people employed in its month, so a day before
// the entry or after the exit owes nothing; a Berufsschule day counts as its normal target, so the
// person owes nothing more that day; the Wochenplan sets the target of every other day.

const DAY_MS = 86_400_000;

/** Monday 0 … Sunday 6 of a calendar date. */
const weekdayOf = (localDate: string): number => (new Date(`${localDate}T00:00:00Z`).getUTCDay() + 6) % 7;

function monthDates(month: { start: string; end: string }): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(`${month.start}T00:00:00Z`); ; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date > month.end) return dates;
    dates.push(date);
  }
}

const spanArbitrary = (dates: readonly string[], type: ApprovedAbsenceSpan['type']) =>
  fc
    .tuple(
      fc.constantFrom(...dates),
      fc.nat({ max: 6 }),
      fc.constantFrom('full' as const, 'half_day' as const),
    )
    .map(([startDate, days, dayPortion]) => ({
      type,
      startDate,
      endDate: new Date(Date.parse(`${startDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10),
      // A Berufsschule day is always a full day (lib/personnel/school-days.ts).
      dayPortion: type === 'school' ? ('full' as const) : dayPortion,
    }));

type Drawn = {
  dates: string[];
  weekMinutes: number[];
  entryDate: string | null;
  exitDate: string | null;
  vacations: ApprovedAbsenceSpan[];
  sickness: ApprovedAbsenceSpan[];
  school: ApprovedAbsenceSpan[];
  closures: string[];
  policy: TimeAccountPolicy | null;
};

// Ten days of a month keep each run cheap; every rule here holds day by day.
const periodArbitrary: fc.Arbitrary<Drawn> = fc
  .tuple(yearMonthArbitrary, fc.nat({ max: 18 }))
  .chain(([{ year, month }, first]) => {
    const dates = monthDates(berlinMonth(year, month)).slice(first, first + 10);
    const optionalDate = fc.option(fc.constantFrom(...dates), { nil: null });
    return fc.record({
      dates: fc.constant(dates),
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
      policy: fc.option(policyArbitrary, { nil: null }),
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
          holidayRegion: null,
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

const isSchoolDay = (spans: readonly ApprovedAbsenceSpan[], date: string): boolean =>
  spans.some((span) => span.startDate <= date && date <= span.endDate);

/**
 * werk-flow/werkflow-planning#523: a vacation or sickness the policy counts as informational brings
 * a closure day's Wochenplan target back. The known-bug case below holds that class.
 */
const informationalOnDayOff = (drawn: Drawn, date: string): boolean =>
  drawn.closures.includes(date) &&
  isSchoolDay([...drawn.vacations, ...drawn.sickness], date) &&
  (drawn.policy?.vacationTreatment === 'informational' ||
    drawn.policy?.sicknessTreatment === 'informational');

describe('The daily targets of a period', () => {
  test('give every day of the month one row, never more than the Wochenplan of its weekday', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        const days = resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets;
        expect(days.map((day) => day.localDate)).toEqual(drawn.dates);
        for (const day of days) {
          expect(day.targetMinutes).toBeGreaterThanOrEqual(0);
          expect(day.targetMinutes).toBeLessThanOrEqual(drawn.weekMinutes[weekdayOf(day.localDate)] ?? 0);
          expect(day.source).toBe('schedule');
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

  test('credit a working Berufsschule day without other absence with its full Wochenplan target', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        for (const day of resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets) {
          const plan = drawn.weekMinutes[weekdayOf(day.localDate)] ?? 0;
          const otherAbsence = isSchoolDay([...drawn.vacations, ...drawn.sickness], day.localDate);
          if (
            isSchoolDay(drawn.school, day.localDate) &&
            !otherAbsence &&
            employed(drawn, day.localDate) &&
            !drawn.closures.includes(day.localDate)
          )
            expect(day.schoolMinutes).toBe(plan);
          if (!isSchoolDay(drawn.school, day.localDate)) expect(day.schoolMinutes).toBe(0);
        }
      }),
    );
  });

  test('owe nothing on a closure day, whatever absence covers it', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        for (const day of resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets)
          if (drawn.closures.includes(day.localDate) && !informationalOnDayOff(drawn, day.localDate))
            expect(day.targetMinutes).toBe(0);
      }),
    );
  });

  test('owe nothing on a Berufsschule day, and change no other day for it', () => {
    fc.assert(
      fc.property(periodArbitrary, (drawn) => {
        const withSchool = resolveEmployeeDailyTargets(...argumentsFor(drawn)).dailyTargets;
        const without = resolveEmployeeDailyTargets(...argumentsFor({ ...drawn, school: [] })).dailyTargets;
        for (const [index, day] of withSchool.entries()) {
          if (informationalOnDayOff(drawn, day.localDate)) continue;
          if (isSchoolDay(drawn.school, day.localDate)) expect(day.targetMinutes).toBe(0);
          else expect(day).toEqual(without[index] ?? day);
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
