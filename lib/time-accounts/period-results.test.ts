// Rule test: not computed is not zero, and the Monatswerte keep one order (werk-flow/werkflow-planning#47, #89).
import { describe, expect, test } from 'bun:test';

import { employeeSetupGaps, toPeriodResultRows } from './period-results';

const ANNA = 'a0000000-0000-4000-8000-000000000001';
const BERND = 'b0000000-0000-4000-8000-000000000002';
const BERND_TWIN = 'b0000000-0000-4000-8000-000000000003';
const NAMES = new Map([
  [ANNA, 'Anna Ärger'],
  [BERND, 'Bernd Bauer'],
  [BERND_TWIN, 'Bernd Bauer'],
]);

/** A stored result row; an uncalculated person's row holds the preparation's placeholder zeros. */
function stored(employeeRecordId: string, minutes: number) {
  return {
    employee_record_id: employeeRecordId,
    target_minutes: minutes,
    credited_minutes: minutes,
    period_delta_minutes: 0,
    closing_balance_minutes: minutes,
    authoritative_targets: true,
  };
}

describe('employeeSetupGaps', () => {
  test('names each gap that keeps a month from being calculated', () => {
    expect(employeeSetupGaps({ hasCompletePolicy: true, hasAccount: true })).toEqual([]);
    expect(employeeSetupGaps({ hasCompletePolicy: false, hasAccount: false })).toEqual([
      'missing_policy',
      'missing_opening_balance',
    ]);
  });
});

describe('toPeriodResultRows', () => {
  test('a person with a missing policy or account carries the causes and no minutes', () => {
    const rows = toPeriodResultRows(
      [stored(ANNA, 0), stored(BERND, 10_620)],
      [
        { employee_record_id: ANNA, finding_kind: 'missing_opening_balance' },
        { employee_record_id: ANNA, finding_kind: 'missing_schedule' },
        { employee_record_id: ANNA, finding_kind: 'missing_policy' },
        { employee_record_id: BERND, finding_kind: 'positive_overtime' },
      ],
      NAMES,
    );
    expect(rows[0]).toEqual({
      employeeRecordId: ANNA,
      employeeName: 'Anna Ärger',
      authoritativeTargets: true,
      outcome: { computed: false, causes: ['missing_policy', 'missing_opening_balance'] },
    });
    expect(rows[0]?.outcome).not.toHaveProperty('creditedMinutes');
    expect(rows[1]?.outcome).toEqual({
      computed: true,
      targetMinutes: 10_620,
      creditedMinutes: 10_620,
      periodDeltaMinutes: 0,
      closingBalanceMinutes: 10_620,
    });
  });

  test('sorts by name, then by person, whatever order the rows arrive in', () => {
    const order = (results: ReturnType<typeof stored>[]) =>
      toPeriodResultRows(results, [], NAMES).map((row) => row.employeeRecordId);
    const expected = [ANNA, BERND, BERND_TWIN];
    expect(order([stored(BERND_TWIN, 1), stored(BERND, 1), stored(ANNA, 1)])).toEqual(expected);
    expect(order([stored(BERND, 1), stored(ANNA, 1), stored(BERND_TWIN, 1)])).toEqual(expected);
  });
});
