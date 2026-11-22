import { describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import type { Tables } from '@/lib/supabase/database.types';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { berlinMonth, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Payroll export": one reproducible export per closed period version that covers the whole
// workforce of that version. The rows do not depend on the order the sources are read in, a
// day's credited minutes reach its sources without losing or adding a minute, and a correction
// counts for the period exactly when it moved time between the month's Berlin midnights.

// payroll-export-rows reads server-only modules; the stub lets the unit tier import it.
mock.module('server-only', () => ({}));
const { buildPayrollExportRows } = await import('./payroll-export-rows');

type Sources = Parameters<typeof buildPayrollExportRows>[0];

const EMPLOYEES = ['employee-1', 'employee-2', 'employee-3'];
const CREATED = '2026-01-01T00:00:00Z';
const ORG = 'org-1';

const CALCULATION: Tables<'time_period_calculations'> = {
  absence_minutes: 0,
  account_event_minutes: 0,
  calculation_schema_version: 1,
  credited_minutes: 0,
  generated_at: CREATED,
  generated_by: 'user-1',
  id: 'calculation-1',
  organization_id: ORG,
  overtime_minutes: 0,
  period_id: 'period-1',
  source_fingerprint: 'fingerprint',
  source_seconds: 0,
  target_minutes: 0,
  version: 3,
};

const CLOSE_VERSION: Tables<'time_period_close_versions'> = {
  calculation_id: CALCULATION.id,
  closed_at: CREATED,
  closed_by: 'user-1',
  closing_balance_total_minutes: 0,
  id: 'close-1',
  opening_balance_total_minutes: 0,
  organization_id: ORG,
  period_delta_total_minutes: 0,
  period_id: 'period-1',
  source_fingerprint: 'fingerprint',
  supersedes_close_version_id: null,
  version: 1,
};

const MAPPING_VERSION: Tables<'payroll_mapping_versions'> = {
  confirmed_at: CREATED,
  confirmed_by: 'user-1',
  generator_compatibility_version: 'p1-23-v1',
  id: 'mapping-1',
  operation_id: 'operation-1',
  organization_id: ORG,
  profile_id: 'profile-1',
  request_hash: 'hash',
  version: 1,
};

const employeeResult = (
  employee: string,
  minutes: readonly number[],
): Tables<'time_period_employee_results'> => ({
  account_event_minutes: 0,
  authoritative_targets: true,
  calculation_id: CALCULATION.id,
  closing_balance_minutes: minutes[0] ?? 0,
  created_at: CREATED,
  credited_minutes: 0,
  employee_record_id: employee,
  id: `result-${employee}`,
  organization_id: ORG,
  overtime_candidate_minutes: minutes[1] ?? 0,
  period_delta_minutes: 0,
  policy_version_id: 'policy-version-1',
  previous_balance_minutes: minutes[2] ?? 0,
  sickness_minutes: 0,
  source_minutes: 0,
  source_seconds: 0,
  target_minutes: minutes[3] ?? 0,
  vacation_minutes: 0,
});

const dailyArbitrary = (dates: readonly string[]) =>
  fc.record({
    employee: fc.constantFrom(...EMPLOYEES),
    localDate: fc.constantFrom(...dates),
    activityKind: fc.constantFrom('work' as const, 'travel' as const, 'callout' as const),
    creditedMinutes: fc.nat({ max: 900 }),
    sourceSeconds: fc.nat({ max: 60_000 }),
    supplementMinutes: fc.array(fc.nat({ max: 120 }), { minLength: 5, maxLength: 5 }),
    sources: fc.array(fc.nat({ max: 30_000 }), { maxLength: 3 }),
  });

const exportArbitrary = yearMonthArbitrary.chain(({ year, month }) => {
  const period = berlinMonth(year, month);
  const dates = [period.start, period.end];
  const turns = [berlinMidnightMs(period.start), berlinMidnightMs(period.endExclusive)];
  return fc.record({
    period: fc.constant(period),
    results: fc.array(fc.integer({ min: -9_000, max: 9_000 }), { minLength: 12, maxLength: 12 }),
    dailies: fc.array(dailyArbitrary(dates), { maxLength: 5 }),
    events: fc.array(
      fc.record({
        employee: fc.constantFrom(...EMPLOYEES),
        kind: fc.constantFrom(
          'manual_adjustment' as const,
          'payout' as const,
          'expiry' as const,
          'opening_balance' as const,
        ),
        minutes: fc.integer({ min: -3_000, max: 3_000 }),
      }),
      { maxLength: 3 },
    ),
    // Facts within an hour of the month's first or last Berlin midnight, some an hour off.
    applications: fc.array(
      fc.record({
        request: fc.constantFrom('request-1', 'request-2', 'request-unknown'),
        facts: fc.array(
          fc
            .tuple(fc.constantFrom(...turns), fc.integer({ min: -3_600, max: 3_600 }))
            .map(([turn, offset]) => turn + offset * 1_000),
          { maxLength: 2 },
        ),
      }),
      { maxLength: 3 },
    ),
  });
});

type Drawn = typeof exportArbitrary extends fc.Arbitrary<infer Value> ? Value : never;

function sourcesOf(drawn: Drawn): Sources {
  const dailyResults: Tables<'time_period_daily_results'>[] = drawn.dailies.map((daily, index) => ({
    activity_kind: daily.activityKind,
    created_at: CREATED,
    credit_percentage: 100,
    credited_minutes: daily.creditedMinutes,
    credited_seconds: daily.creditedMinutes * 60,
    employee_record_id: daily.employee,
    employee_result_id: `result-${daily.employee}`,
    id: `daily-${index}`,
    local_date: daily.localDate,
    night_minutes: daily.supplementMinutes[0] ?? 0,
    organization_id: ORG,
    public_holiday_minutes: daily.supplementMinutes[1] ?? 0,
    rounding_delta_seconds: 0,
    sickness_minutes: daily.supplementMinutes[2] ?? 0,
    source_minutes: Math.round(daily.sourceSeconds / 60),
    source_seconds: daily.sourceSeconds,
    standby_context: null,
    sunday_minutes: daily.supplementMinutes[3] ?? 0,
    target_minutes: 0,
    travel_role: null,
    travel_route: null,
    vacation_minutes: daily.supplementMinutes[4] ?? 0,
  }));
  return {
    calculation: CALCULATION,
    closeVersion: CLOSE_VERSION,
    mappingVersion: MAPPING_VERSION,
    employeeMappings: EMPLOYEES.map((employee, index) => ({
      created_at: CREATED,
      employee_record_id: employee,
      external_employee_reference: `PN-${index + 1}`,
      id: `employee-mapping-${index}`,
      mapping_version_id: MAPPING_VERSION.id,
      organization_id: ORG,
    })),
    codeMappings: [
      {
        activity_kind: null,
        created_at: CREATED,
        id: 'code-1',
        mapping_version_id: MAPPING_VERSION.id,
        organization_id: ORG,
        output_code: 'SOLL',
        value_kind: 'target',
      },
    ],
    employeeResults: EMPLOYEES.map((employee, index) =>
      employeeResult(employee, drawn.results.slice(index * 4, index * 4 + 4)),
    ),
    employeeIds: [...EMPLOYEES],
    dailyResults,
    resultSources: drawn.dailies.flatMap((daily, dailyIndex) =>
      daily.sources.map((sourceSeconds, index) => ({
        created_at: CREATED,
        daily_result_id: `daily-${dailyIndex}`,
        employee_result_id: `result-${daily.employee}`,
        id: `source-${dailyIndex}-${index}`,
        organization_id: ORG,
        source_fingerprint: 'fingerprint',
        source_id: `segment-${dailyIndex}-${index}`,
        source_key: null,
        source_kind: 'time_segment',
        source_snapshot: { sourceSeconds, allocationKind: 'job', jobNumber: 'A-1' },
      })),
    ),
    accountEvents: drawn.events.map((event, index) => ({
      account_id: `account-${event.employee}`,
      adjustment_request_id: null,
      close_version_id: null,
      created_at: CREATED,
      created_by: 'user-1',
      effective_date: drawn.period.start,
      employee_record_id: event.employee,
      event_kind: event.kind,
      id: `event-${index}`,
      minutes: event.minutes,
      operation_id: `operation-${index}`,
      organization_id: ORG,
      reason: 'Korrektur',
      request_hash: 'hash',
      reverses_event_id: null,
    })),
    correctionRequests: [
      { id: 'request-1', subject_employee_record_id: 'employee-1' },
      { id: 'request-2', subject_employee_record_id: 'employee-2' },
    ],
    correctionApplications: drawn.applications.map((application, index) => ({
      id: `application-${index}`,
      request_id: application.request,
      revision: 1,
      source_fingerprint: 'fingerprint',
      applied_snapshot: {
        schemaVersion: 1,
        // Database text carries `+00:00`, ISO text `Z`; both must count alike.
        facts: application.facts.map((instant, factIndex) => ({
          timestamp:
            factIndex % 2 === 0
              ? new Date(instant).toISOString()
              : new Date(instant).toISOString().replace('Z', '+00:00'),
        })),
      },
    })),
  };
}

const periodOf = (drawn: Drawn) => ({
  period_start_date: drawn.period.start,
  period_end_date: drawn.period.end,
});

describe('The rows of a payroll export', () => {
  test('do not depend on the order the closed period’s sources are read in', () => {
    fc.assert(
      fc.property(exportArbitrary, fc.nat(), (drawn, seed) => {
        const sources = sourcesOf(drawn);
        // A permutation the drawn seed fixes, so a failure replays.
        const shuffle = <Row>(rows: readonly Row[]): Row[] =>
          rows
            .map((row, index) => ({ row, key: (Math.imul(index + 1, 2_654_435_761) ^ seed) >>> 0 }))
            .sort((left, right) => left.key - right.key)
            .map(({ row }) => row);
        const shuffled: Sources = {
          ...sources,
          employeeMappings: shuffle(sources.employeeMappings),
          employeeResults: shuffle(sources.employeeResults),
          dailyResults: shuffle(sources.dailyResults),
          resultSources: shuffle(sources.resultSources),
          accountEvents: shuffle(sources.accountEvents),
          correctionRequests: shuffle(sources.correctionRequests),
          correctionApplications: shuffle(sources.correctionApplications),
        };
        expect(buildPayrollExportRows(shuffled, periodOf(drawn))).toEqual(
          buildPayrollExportRows(sources, periodOf(drawn)),
        );
      }),
    );
  });

  test('allocate each day’s credited minutes to its sources without losing or adding a minute', () => {
    fc.assert(
      fc.property(exportArbitrary, (drawn) => {
        const { allocationRows, valueRows } = buildPayrollExportRows(sourcesOf(drawn), periodOf(drawn));
        for (const [index, daily] of drawn.dailies.entries()) {
          const allocated = allocationRows
            .filter((row) => row.rowId.startsWith(`source-${index}-`))
            .reduce((sum, row) => sum + row.creditedMinutes, 0);
          const recorded = daily.sources.reduce((sum, seconds) => sum + seconds, 0);
          expect(allocated).toBe(recorded > 0 ? daily.creditedMinutes : 0);
          const credited = valueRows.find((row) => row.rowId === `daily-${index}:credited`);
          expect(credited?.minutes ?? 0).toBe(daily.creditedMinutes);
        }
      }),
    );
  });

  test('carry a correction exactly when it moved time between the month’s Berlin midnights', () => {
    fc.assert(
      fc.property(exportArbitrary, (drawn) => {
        const start = berlinMidnightMs(drawn.period.start);
        const end = berlinMidnightMs(drawn.period.endExclusive);
        const expected = drawn.applications
          .map((application, index) => ({ application, id: `application-${index}` }))
          .filter(
            ({ application }) =>
              application.request !== 'request-unknown' &&
              application.facts.some((instant) => instant >= start && instant < end),
          )
          .map(({ id }) => id)
          .sort();
        const { correctionRows } = buildPayrollExportRows(sourcesOf(drawn), periodOf(drawn));
        expect(correctionRows.map((row) => row.rowId)).toEqual(expected);
      }),
    );
  });

  test('refuse a workforce member without an employee mapping', () => {
    fc.assert(
      fc.property(exportArbitrary, fc.constantFrom(...EMPLOYEES), (drawn, unmapped) => {
        const sources = sourcesOf(drawn);
        const without = {
          ...sources,
          employeeMappings: sources.employeeMappings.filter(
            (mapping) => mapping.employee_record_id !== unmapped,
          ),
        };
        expect(() => buildPayrollExportRows(without, periodOf(drawn))).toThrow(
          'payroll_employee_mapping_missing',
        );
      }),
    );
  });
});
