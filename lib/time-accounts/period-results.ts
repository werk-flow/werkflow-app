import type { Tables } from '@/lib/supabase/database.types';

// The Monatswerte of a prepared period as the period page reads them. A
// person without a complete Arbeitszeitregel or without an opened Zeitkonto
// cannot be calculated: the preparation stores placeholder zeros for them and
// a blocking finding per gap (period-preparation.ts). Not computed is not
// zero (werk-flow/werkflow-planning#47), so such a row carries its causes and
// no minutes at all.

/** A setup gap that keeps the preparation from calculating a person. */
export type UncomputedResultCause = 'missing_policy' | 'missing_opening_balance';

/**
 * The gaps that keep one person's month from being calculated, in the order
 * the preparation pushes their findings. Empty means the month is calculated.
 */
export function employeeSetupGaps(setup: {
  hasCompletePolicy: boolean;
  hasAccount: boolean;
}): UncomputedResultCause[] {
  return [
    ...(setup.hasCompletePolicy ? [] : ['missing_policy' as const]),
    ...(setup.hasAccount ? [] : ['missing_opening_balance' as const]),
  ];
}

const UNCOMPUTED_RESULT_CAUSES: ReadonlySet<string> = new Set<UncomputedResultCause>([
  'missing_policy',
  'missing_opening_balance',
]);

function isUncomputedResultCause(kind: string): kind is UncomputedResultCause {
  return UNCOMPUTED_RESULT_CAUSES.has(kind);
}

export type PeriodResultValues = {
  targetMinutes: number;
  creditedMinutes: number;
  periodDeltaMinutes: number;
  closingBalanceMinutes: number;
};

export type PeriodResultRow = {
  employeeRecordId: string;
  employeeName: string;
  /** Every day's Soll comes from a Wochenplan. */
  authoritativeTargets: boolean;
  /** The normal target the person's Berufsschule days credit in the period; 0 without any. */
  schoolMinutes: number;
  outcome: ({ computed: true } & PeriodResultValues) | { computed: false; causes: UncomputedResultCause[] };
};

type StoredResult = Pick<
  Tables<'time_period_employee_results'>,
  | 'employee_record_id'
  | 'target_minutes'
  | 'credited_minutes'
  | 'period_delta_minutes'
  | 'closing_balance_minutes'
  | 'authoritative_targets'
>;
type StoredFinding = Pick<Tables<'time_period_findings'>, 'employee_record_id' | 'finding_kind'>;

/**
 * The calculation's result rows, sorted by name and then by person so the
 * order stays the same across preparations (werk-flow/werkflow-planning#89).
 * A person with a setup-gap finding of the same calculation is not computed.
 */
export function toPeriodResultRows(
  results: readonly StoredResult[],
  findings: readonly StoredFinding[],
  nameByEmployee: ReadonlyMap<string, string>,
  schoolMinutesByEmployee: ReadonlyMap<string, number>,
): PeriodResultRow[] {
  const causesByEmployee = new Map<string, UncomputedResultCause[]>();
  for (const finding of findings) {
    if (!finding.employee_record_id || !isUncomputedResultCause(finding.finding_kind)) continue;
    const causes = causesByEmployee.get(finding.employee_record_id) ?? [];
    if (!causes.includes(finding.finding_kind)) causes.push(finding.finding_kind);
    causesByEmployee.set(finding.employee_record_id, causes);
  }
  return results
    .map((result): PeriodResultRow => {
      const causes = causesByEmployee.get(result.employee_record_id) ?? [];
      return {
        employeeRecordId: result.employee_record_id,
        employeeName: nameByEmployee.get(result.employee_record_id) ?? 'Unbekannt',
        authoritativeTargets: result.authoritative_targets,
        schoolMinutes: schoolMinutesByEmployee.get(result.employee_record_id) ?? 0,
        outcome:
          causes.length > 0
            ? { computed: false, causes: employeeSetupGapOrder(causes) }
            : {
                computed: true,
                targetMinutes: result.target_minutes,
                creditedMinutes: result.credited_minutes,
                periodDeltaMinutes: result.period_delta_minutes,
                closingBalanceMinutes: result.closing_balance_minutes,
              },
      };
    })
    .sort(
      (left, right) =>
        left.employeeName.localeCompare(right.employeeName, 'de') ||
        left.employeeRecordId.localeCompare(right.employeeRecordId),
    );
}

function employeeSetupGapOrder(causes: readonly UncomputedResultCause[]): UncomputedResultCause[] {
  return employeeSetupGaps({
    hasCompletePolicy: !causes.includes('missing_policy'),
    hasAccount: !causes.includes('missing_opening_balance'),
  });
}
