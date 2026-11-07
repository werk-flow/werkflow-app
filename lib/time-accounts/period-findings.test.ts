// Rule test: a period finding names its real cause (werk-flow/werkflow-planning#47, #48).
import { describe, expect, mock, test } from 'bun:test';

import { employeeSetupGaps } from './period-results';
import type { DailyTargetInput, EmployeePeriodCalculation, TimeActivityInterval } from './types';

mock.module('server-only', () => ({}));
const { pushEmployeeFindings } = await import('./period-findings');
const { getDateRange } = await import('./period-sources');

const EMPLOYEE = { id: 'b1f0c3a2-0000-4000-8000-000000000001', user_id: null };
const DATES = getDateRange('2026-09-01', '2026-09-30');

function targets(source: DailyTargetInput['source']): Map<string, DailyTargetInput> {
  return new Map(
    DATES.map((date) => [
      date,
      { localDate: date, targetMinutes: 510, source, vacationMinutes: 0, sicknessMinutes: 0 },
    ]),
  );
}

/** The placeholder the preparation stores for a person it cannot calculate. */
const UNCALCULATED: EmployeePeriodCalculation = {
  employeeRecordId: EMPLOYEE.id,
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  policyId: '',
  policyVersion: 0,
  activityBuckets: [],
  supplementBuckets: [],
  targetMinutes: 0,
  sourceMinutes: 0,
  creditedMinutes: 0,
  vacationMinutes: 0,
  sicknessMinutes: 0,
  accountEventMinutes: 0,
  periodDeltaMinutes: 0,
  overtimeCandidateMinutes: 0,
  previousBalanceMinutes: 0,
  closingBalanceMinutes: 0,
  hasAuthoritativeTargets: false,
};

function findingsFor(input: {
  setup: { hasCompletePolicy: boolean; hasAccount: boolean };
  targetsByDate: Map<string, DailyTargetInput>;
  intervals?: TimeActivityInterval[];
}): Array<Record<string, unknown>> {
  const findingPayload: Array<Record<string, unknown>> = [];
  pushEmployeeFindings({
    employee: EMPLOYEE,
    setupGaps: employeeSetupGaps(input.setup),
    policiesByDate: new Map(DATES.map((date) => [date, null])),
    calculation: UNCALCULATED,
    intervals: input.intervals ?? [],
    targetsByDate: input.targetsByDate,
    shared: {
      startInstant: '2026-08-31T22:00:00.000Z',
      endInstant: '2026-09-30T22:00:00.000Z',
      sources: { sessions: [], correctionRequests: [], correctionRevisions: [] },
      index: { dates: DATES, legacyByUser: new Map() },
      payloads: { findingPayload },
    },
  });
  return findingPayload;
}

function kinds(findings: Array<Record<string, unknown>>): unknown[] {
  return findings.map((finding) => finding.finding_kind);
}

describe('period setup findings', () => {
  test('a person with a valid Wochenplan and a missing policy gets no missing_schedule', () => {
    expect(
      kinds(
        findingsFor({
          setup: { hasCompletePolicy: false, hasAccount: true },
          targetsByDate: targets('schedule'),
        }),
      ),
    ).toEqual(['missing_policy']);
  });

  test('a person with a valid Wochenplan and a missing account gets no missing_schedule', () => {
    expect(
      kinds(
        findingsFor({
          setup: { hasCompletePolicy: true, hasAccount: false },
          targetsByDate: targets('schedule'),
        }),
      ),
    ).toEqual(['missing_opening_balance']);
  });

  test('a missing Wochenplan is still named next to the setup gaps', () => {
    expect(
      kinds(
        findingsFor({
          setup: { hasCompletePolicy: false, hasAccount: false },
          targetsByDate: targets('default'),
        }),
      ),
    ).toEqual(['missing_policy', 'missing_opening_balance', 'missing_schedule']);
    expect(
      kinds(
        findingsFor({
          setup: { hasCompletePolicy: true, hasAccount: true },
          targetsByDate: targets('employment_condition'),
        }),
      ),
    ).toEqual(['missing_schedule']);
  });
});

describe('Zeit ohne Zuordnung', () => {
  test('names the day, the minutes and each entry, so the decision is not blind', () => {
    const interval = (startedAt: string, endedAt: string): TimeActivityInterval => ({
      sourceId: `segment:${startedAt}`,
      startedAt,
      endedAt,
      activityKind: 'work',
      allocationKind: 'unallocated',
    });
    const [finding] = findingsFor({
      setup: { hasCompletePolicy: true, hasAccount: true },
      targetsByDate: targets('schedule'),
      // Out of order on purpose: the explanation lists the entries by time.
      intervals: [
        interval('2026-09-08T13:00:00.000Z', '2026-09-08T13:30:00.000Z'),
        interval('2026-09-07T06:00:00.000Z', '2026-09-07T07:15:00.000Z'),
      ],
    });
    expect(finding?.finding_kind).toBe('unallocated_time');
    expect(finding?.explanation).toEqual({
      count: 2,
      minutes: 105,
      entries: [
        {
          date: '2026-09-07',
          startedAt: '2026-09-07T06:00:00.000Z',
          endedAt: '2026-09-07T07:15:00.000Z',
          activityKind: 'work',
          minutes: 75,
        },
        {
          date: '2026-09-08',
          startedAt: '2026-09-08T13:00:00.000Z',
          endedAt: '2026-09-08T13:30:00.000Z',
          activityKind: 'work',
          minutes: 30,
        },
      ],
    });
  });
});
