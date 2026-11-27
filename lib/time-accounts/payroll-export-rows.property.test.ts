import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { Tables } from '@/lib/supabase/database.types';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { berlinMonth, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';
import { PAYROLL_CODE_ROWS } from './payroll-mapping';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Payroll export": one reproducible export per closed period version that covers the whole
// workforce of that version. The rows do not depend on the order the sources are read in, a
// day's credited minutes reach its sources without losing or adding a minute, and a correction
// counts for the period exactly when it moved time between the month's Berlin midnights. Every
// nonzero value of the version reaches the export with its classification, signed minutes, the
// confirmed Lohnart code and the employee's payroll reference ("An Admin sees and edits the
// Lohnart code of every classification before confirming").

const { buildPayrollExportRows } = await import('./payroll-export-rows');

type Sources = Parameters<typeof buildPayrollExportRows>[0];

const EMPLOYEES = ['employee-1', 'employee-2', 'employee-3'];
/** Every activity the code table gives credited time a code for. */
const ACTIVITY_KINDS = PAYROLL_CODE_ROWS.flatMap((codeRow) =>
  codeRow.activityKind ? [codeRow.activityKind] : [],
);
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
    activityKind: fc.constantFrom(...ACTIVITY_KINDS),
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
    // One distinct confirmed code per classification of the mapping table.
    codes: fc
      .uniqueArray(fc.nat({ max: 9_999 }), {
        minLength: PAYROLL_CODE_ROWS.length,
        maxLength: PAYROLL_CODE_ROWS.length,
      })
      .map((numbers) => numbers.map((number) => `L${number}`)),
    results: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: -9_000, max: 9_000 })), {
      minLength: 12,
      maxLength: 12,
    }),
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
    codeMappings: PAYROLL_CODE_ROWS.map((codeRow, index) => ({
      activity_kind: codeRow.activityKind,
      created_at: CREATED,
      id: `code-${index}`,
      mapping_version_id: MAPPING_VERSION.id,
      organization_id: ORG,
      output_code: drawn.codes[index] ?? '',
      value_kind: codeRow.valueKind,
    })),
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

/** One value of the closed version as the export must carry it. */
type ExportedValue = {
  employeeRecordId: string;
  externalEmployeeReference: string;
  localDate: string;
  valueKind: string;
  outputCode: string;
  minutes: number;
};

/** Every value the drawn version holds, each with the code its classification was confirmed with. */
function versionValues(drawn: Drawn): ExportedValue[] {
  const codeOf = (valueKind: string, activityKind: string | null = null): string =>
    drawn.codes[
      PAYROLL_CODE_ROWS.findIndex(
        (codeRow) => codeRow.valueKind === valueKind && codeRow.activityKind === activityKind,
      )
    ] ?? 'no confirmed code';
  const value = (
    employee: string,
    localDate: string,
    valueKind: string,
    minutes: number,
    activityKind: string | null = null,
  ): ExportedValue => ({
    employeeRecordId: employee,
    externalEmployeeReference: `PN-${EMPLOYEES.indexOf(employee) + 1}`,
    localDate,
    valueKind,
    outputCode: codeOf(valueKind, activityKind),
    minutes,
  });
  return [
    ...drawn.dailies.flatMap((daily) => {
      const [night = 0, holiday = 0, sickness = 0, sunday = 0, vacation = 0] = daily.supplementMinutes;
      const on = (valueKind: string, minutes: number, activityKind: string | null = null) =>
        value(daily.employee, daily.localDate, valueKind, minutes, activityKind);
      return [
        on('source_attendance', Math.round(daily.sourceSeconds / 60)),
        on('effective_attendance', daily.creditedMinutes),
        on('credited_activity', daily.creditedMinutes, daily.activityKind),
        on('vacation', vacation),
        on('sickness', sickness),
        on('night_supplement', night),
        on('sunday_supplement', sunday),
        on('public_holiday_supplement', holiday),
      ];
    }),
    ...EMPLOYEES.flatMap((employee, index) => {
      const [closing = 0, overtime = 0, opening = 0, target = 0] = drawn.results.slice(
        index * 4,
        index * 4 + 4,
      );
      return [
        value(employee, drawn.period.end, 'target', target),
        value(employee, drawn.period.end, 'overtime', overtime),
        value(employee, drawn.period.end, 'opening_balance', opening),
        value(employee, drawn.period.end, 'closing_balance', closing),
      ];
    }),
    ...drawn.events.map((event) => value(event.employee, drawn.period.start, event.kind, event.minutes)),
  ];
}

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

  test('carry every nonzero value with its classification, signed minutes, confirmed code and payroll reference', () => {
    fc.assert(
      fc.property(exportArbitrary, (drawn) => {
        const key = (row: ExportedValue): string =>
          JSON.stringify([
            row.employeeRecordId,
            row.externalEmployeeReference,
            row.localDate,
            row.valueKind,
            row.outputCode,
            row.minutes,
          ]);
        const exported = buildPayrollExportRows(sourcesOf(drawn), periodOf(drawn)).valueRows.map(key);
        const values = versionValues(drawn);
        for (const required of values.filter((row) => row.minutes !== 0).map(key)) {
          expect(exported).toContain(required);
          exported.splice(exported.indexOf(required), 1);
        }
        // A row left over may only be a zero value of the version, never an invented one.
        const zeroValues = values.filter((row) => row.minutes === 0).map(key);
        for (const row of exported) {
          expect(zeroValues).toContain(row);
          zeroValues.splice(zeroValues.indexOf(row), 1);
        }
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
