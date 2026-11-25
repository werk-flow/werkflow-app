import { describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import { berlinMidnightMs, berlinOffsetMinutes } from '@/lib/testing/berlin-arbitraries';
import {
  activityIntervalsAround,
  berlinMonth,
  policyArbitrary,
  yearMonthArbitrary,
} from '@/lib/testing/time-account-arbitraries';
import { calculateEmployeePeriod } from './calculation';
import { employeeSetupGaps } from './period-results';
import type { DailyTargetInput, TimeActivityInterval } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close" and "Findings and adjustments": a missing policy or account blocks the close with
// its own finding, and „Arbeitsplan fehlt“ comes from the Wochenplan alone; a correction request
// that proposes a time in the period blocks the close while it is open; „Zeit ohne Zuordnung“
// lists each entry with its day, time, activity and minutes.

// period-findings is server-only; the stub lets the unit tier import it.
mock.module('server-only', () => ({}));
const { pushEmployeeFindings } = await import('./period-findings');

const EMPLOYEE = { id: 'record-1', user_id: null };
const DAY_MS = 86_400_000;
const OPEN_STATUSES = new Set(['submitted', 'clarification_required']);

function monthDates(month: { start: string; end: string }): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(`${month.start}T00:00:00Z`); ; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date > month.end) return dates;
    dates.push(date);
  }
}

/** The Berlin date of an instant by the EU rule. */
const oracleDate = (instant: number): string =>
  new Date(instant + berlinOffsetMinutes(instant) * 60_000).toISOString().slice(0, 10);

const requestArbitrary = (turns: readonly number[]) =>
  fc.record({
    subject: fc.constantFrom(EMPLOYEE.id, 'record-2'),
    status: fc.constantFrom(
      'submitted' as const,
      'clarification_required' as const,
      'approved' as const,
      'rejected' as const,
      'withdrawn' as const,
    ),
    // Fact instants within two hours of a month's first or last Berlin midnight.
    currentFacts: fc.array(
      fc
        .tuple(fc.constantFrom(...turns), fc.integer({ min: -7_200, max: 7_200 }))
        .map(([turn, offset]) => turn + offset * 1_000),
      { maxLength: 3 },
    ),
    earlierFacts: fc.array(fc.constantFrom(...turns), { maxLength: 2 }),
  });

const findingsArbitrary = yearMonthArbitrary.chain(({ year, month }) => {
  const period = berlinMonth(year, month);
  const turns = [berlinMidnightMs(period.start), berlinMidnightMs(period.endExclusive)];
  return fc.record({
    period: fc.constant(period),
    intervals: activityIntervalsAround(turns[1] ?? 0),
    policy: policyArbitrary,
    // Days of the month without a policy version in force, by index, and whether an account exists.
    daysWithoutPolicy: fc.array(fc.nat({ max: 30 }), { maxLength: 3 }),
    hasAccount: fc.boolean(),
    sources: fc.array(
      fc.constantFrom('schedule' as const, 'employment_condition' as const, 'default' as const),
      {
        minLength: 1,
        maxLength: 4,
      },
    ),
    targetMinutes: fc.oneof(fc.constant(0), fc.nat({ max: 30 }), fc.nat({ max: 600 })),
    requests: fc.array(requestArbitrary(turns), { maxLength: 3 }),
  });
});

type Drawn = typeof findingsArbitrary extends fc.Arbitrary<infer Value> ? Value : never;

/** Every day gets the drawn target and one of the drawn sources; one non-schedule day is enough. */
function targetsFor({ period, sources, targetMinutes }: Drawn): DailyTargetInput[] {
  return monthDates(period).map((localDate, index) => ({
    localDate,
    targetMinutes,
    source: sources[index % sources.length] ?? 'schedule',
    vacationMinutes: 0,
    sicknessMinutes: 0,
    schoolMinutes: 0,
  }));
}

function calculationFor(drawn: Drawn, intervals: readonly TimeActivityInterval[]) {
  return calculateEmployeePeriod({
    employeeRecordId: EMPLOYEE.id,
    periodStart: drawn.period.start,
    periodEnd: drawn.period.end,
    previousBalanceMinutes: 0,
    // No finding here reads a supplement, and supplements cost most of a calculation.
    policy: { ...drawn.policy, supplementRules: [] },
    activityIntervals: intervals,
    dailyTargets: targetsFor(drawn),
    accountEvents: [],
    publicHolidayDates: new Set(),
  });
}

/**
 * The findings of a drawn month. The calculation only feeds the overtime and absence findings, so
 * other properties pass one without recorded time, which costs a fraction of a full one.
 */
function findingsFor(
  drawn: Drawn,
  intervals: readonly TimeActivityInterval[] = drawn.intervals,
  calculation = calculationFor(drawn, []),
) {
  const { period, policy, hasAccount, requests } = drawn;
  const dates = monthDates(period);
  const targets = targetsFor(drawn);
  const missing = new Set(drawn.daysWithoutPolicy.map((day) => dates[day % dates.length]));
  const policiesByDate = new Map(dates.map((date) => [date, missing.has(date) ? null : policy]));
  const findingPayload: Array<Record<string, unknown>> = [];
  pushEmployeeFindings({
    employee: EMPLOYEE,
    // As the preparation derives them from the month's policy calendar and the account.
    setupGaps: employeeSetupGaps({
      hasCompletePolicy: dates.every((date) => policiesByDate.get(date)),
      hasAccount,
    }),
    policiesByDate,
    calculation,
    intervals: [...intervals],
    targetsByDate: new Map(targets.map((target) => [target.localDate, target])),
    shared: {
      startInstant: new Date(berlinMidnightMs(period.start)).toISOString(),
      endInstant: new Date(berlinMidnightMs(period.endExclusive)).toISOString(),
      sources: {
        sessions: [],
        correctionRequests: requests.map((request, index) => ({
          id: `request-${index}`,
          subject_employee_record_id: request.subject,
          current_revision: 2,
          status: request.status,
        })),
        correctionRevisions: requests.flatMap((request, index) =>
          (
            [
              [1, request.earlierFacts],
              [2, request.currentFacts],
            ] as const
          ).map(([revision, facts]) => ({
            request_id: `request-${index}`,
            revision,
            proposed_snapshot: {
              schemaVersion: 1,
              facts: facts.map((instant, factIndex) => ({
                factId: `fact-${factIndex}`,
                employeeRecordId: request.subject,
                userId: 'user-1',
                entryType: 'clock_in',
                // Database text carries `+00:00`, ISO text `Z`; both must count alike.
                timestamp:
                  factIndex % 2 === 0
                    ? new Date(instant).toISOString()
                    : new Date(instant).toISOString().replace('Z', '+00:00'),
                jobId: null,
                activityKind: 'work',
                isManual: true,
              })),
            },
          })),
        ),
      },
      index: { dates, legacyByUser: new Map() },
      payloads: { findingPayload },
    },
  });
  return findingPayload;
}

describe('The findings of a person’s period', () => {
  test('block the close for the person on each missing policy day, missing account and unplanned day', () => {
    fc.assert(
      fc.property(findingsArbitrary, (drawn) => {
        const setupKinds = new Set(['missing_policy', 'missing_opening_balance', 'missing_schedule']);
        const setup = findingsFor(drawn)
          .filter((finding) => setupKinds.has(String(finding.finding_kind)))
          .map(({ employee_record_id, finding_kind, severity }) => ({
            employee_record_id,
            finding_kind,
            severity,
          }))
          .sort((left, right) => String(left.finding_kind).localeCompare(String(right.finding_kind)));
        const expected = [
          ...(drawn.daysWithoutPolicy.length > 0 ? ['missing_policy'] : []),
          ...(drawn.hasAccount ? [] : ['missing_opening_balance']),
          // „Arbeitsplan fehlt“ comes from the Wochenplan alone: a day whose target has another source.
          ...(drawn.sources.every((source) => source === 'schedule') ? [] : ['missing_schedule']),
        ]
          .sort()
          .map((finding_kind) => ({
            employee_record_id: EMPLOYEE.id,
            finding_kind,
            severity: 'close_blocked',
          }));
        expect(setup).toEqual(expected);
      }),
    );
  });

  test('block the close while an open correction proposes a time between the month’s Berlin midnights', () => {
    fc.assert(
      fc.property(findingsArbitrary, (drawn) => {
        const start = berlinMidnightMs(drawn.period.start);
        const end = berlinMidnightMs(drawn.period.endExclusive);
        const blocking = drawn.requests.some(
          (request) =>
            request.subject === EMPLOYEE.id &&
            OPEN_STATUSES.has(request.status) &&
            request.currentFacts.some((instant) => instant >= start && instant < end),
        );
        const pending = findingsFor(drawn).filter((finding) => finding.finding_kind === 'pending_correction');
        expect(pending.length).toBe(blocking ? 1 : 0);
        for (const finding of pending) expect(finding.severity).toBe('close_blocked');
      }),
    );
  });

  test('list each unallocated entry with its Berlin day and rounded minutes, adding up to the total', () => {
    fc.assert(
      fc.property(findingsArbitrary, (drawn) => {
        const finding = findingsFor(drawn).find((item) => item.finding_kind === 'unallocated_time');
        const unallocated = drawn.intervals.filter(
          (interval) =>
            interval.allocationKind === 'unallocated' &&
            !['break', 'standby', 'internal_activity'].includes(interval.activityKind),
        );
        if (unallocated.length === 0) {
          expect(finding).toBeUndefined();
          return;
        }
        const expected = unallocated.map((interval) => ({
          date: oracleDate(Date.parse(interval.startedAt)),
          startedAt: interval.startedAt,
          endedAt: interval.endedAt,
          activityKind: interval.activityKind,
          minutes: Math.round((Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 60_000),
        }));
        expect(finding?.explanation).toEqual({
          count: expected.length,
          minutes: expected.reduce((sum, entry) => sum + entry.minutes, 0),
          entries: expected,
        });
      }),
    );
  });

  test('ask to approve overtime exactly when credited time exceeds the target, with its minutes', () => {
    fc.assert(
      fc.property(findingsArbitrary, (drawn) => {
        const calculation = calculationFor(drawn, drawn.intervals);
        const overtime = findingsFor(drawn, drawn.intervals, calculation).filter(
          (finding) => finding.finding_kind === 'positive_overtime',
        );
        const { creditedMinutes, targetMinutes } = calculation;
        const expected = creditedMinutes - targetMinutes;
        expect(overtime.map((finding) => finding.explanation)).toEqual(
          expected > 0 ? [{ minutes: expected }] : [],
        );
      }),
    );
  });

  test('do not depend on the order the activities are read in', () => {
    fc.assert(
      fc.property(
        findingsArbitrary.chain((drawn) =>
          fc.tuple(
            fc.constant(drawn),
            fc.shuffledSubarray(drawn.intervals, { minLength: drawn.intervals.length }),
          ),
        ),
        ([drawn, shuffled]) => {
          expect(findingsFor(drawn, shuffled)).toEqual(findingsFor(drawn));
        },
      ),
    );
  });
});
