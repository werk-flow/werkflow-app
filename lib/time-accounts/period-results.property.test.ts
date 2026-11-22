import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { toPeriodResultRows } from './period-results';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close": a missing balance or policy blocks close for that person instead of counting as
// zero, and `Monatswerte` shows „Nicht berechnet“ with the cause instead of values. It lists people
// by name, in the same order at every preparation.

const EMPLOYEES = ['e1', 'e2', 'e3', 'e4'];
const FINDING_KINDS = ['missing_policy', 'missing_opening_balance', 'missing_schedule', 'overlap'] as const;

const resultsArbitrary = fc
  .subarray(EMPLOYEES, { minLength: 1 })
  .chain((employees) =>
    fc.record({
      results: fc.tuple(
        ...employees.map((employee_record_id) =>
          fc.record({
            employee_record_id: fc.constant(employee_record_id),
            target_minutes: fc.nat({ max: 12_000 }),
            credited_minutes: fc.nat({ max: 12_000 }),
            period_delta_minutes: fc.integer({ min: -12_000, max: 12_000 }),
            closing_balance_minutes: fc.integer({ min: -60_000, max: 60_000 }),
            authoritative_targets: fc.boolean(),
          }),
        ),
      ),
      findings: fc.array(
        fc.record({
          employee_record_id: fc.option(fc.constantFrom(...EMPLOYEES), { nil: null }),
          finding_kind: fc.constantFrom(...FINDING_KINDS),
        }),
        { maxLength: 8 },
      ),
      names: fc.tuple(...EMPLOYEES.map(() => fc.constantFrom('Anna Berg', 'Ömer Can', 'anna berg', 'Zoe'))),
    }),
  )
  .map(({ results, findings, names }) => ({
    results,
    findings,
    names: new Map(EMPLOYEES.map((employee, index) => [employee, names[index] ?? 'Zoe'])),
  }));

describe('The Monatswerte of a prepared period', () => {
  test('leave a person with a missing policy or account uncalculated, with each cause once', () => {
    fc.assert(
      fc.property(resultsArbitrary, ({ results, findings, names }) => {
        const rows = toPeriodResultRows(results, findings, names, new Map());
        expect(rows.map((row) => row.employeeRecordId).sort()).toEqual(
          results.map((result) => result.employee_record_id).sort(),
        );
        for (const row of rows) {
          const kinds = new Set(
            findings
              .filter((finding) => finding.employee_record_id === row.employeeRecordId)
              .map((finding) => finding.finding_kind),
          );
          const causes = (['missing_policy', 'missing_opening_balance'] as const).filter((kind) =>
            kinds.has(kind),
          );
          const stored = results.find((result) => result.employee_record_id === row.employeeRecordId);
          if (!stored) throw new Error(`no stored result for ${row.employeeRecordId}`);
          if (causes.length > 0) expect(row.outcome).toEqual({ computed: false, causes });
          else
            expect(row.outcome).toEqual({
              computed: true,
              targetMinutes: stored.target_minutes,
              creditedMinutes: stored.credited_minutes,
              periodDeltaMinutes: stored.period_delta_minutes,
              closingBalanceMinutes: stored.closing_balance_minutes,
            });
        }
      }),
    );
  });

  test('list people by name in the same order whatever order the preparation stored them in', () => {
    fc.assert(
      fc.property(
        resultsArbitrary.chain((drawn) =>
          fc.record({
            drawn: fc.constant(drawn),
            results: fc.shuffledSubarray(drawn.results, { minLength: drawn.results.length }),
            findings: fc.shuffledSubarray(drawn.findings, { minLength: drawn.findings.length }),
          }),
        ),
        ({ drawn, results, findings }) => {
          const rows = toPeriodResultRows(drawn.results, drawn.findings, drawn.names, new Map());
          expect(toPeriodResultRows(results, findings, drawn.names, new Map())).toEqual(rows);
          for (const [index, row] of rows.entries()) {
            const next = rows[index + 1];
            if (next) expect(row.employeeName.localeCompare(next.employeeName, 'de')).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });
});
