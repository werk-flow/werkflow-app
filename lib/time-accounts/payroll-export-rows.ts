import { addLocalDays } from '@/lib/date-time/berlin';
import { isJsonRecord } from '@/lib/supabase/json';
import { distributeCreditedMinutes } from './export';
import { PAYROLL_ACCOUNT_EVENT_KINDS, type PayrollExportSources } from './payroll-export-sources';
import { getBerlinInstant } from './period-sources';
import type {
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportValueRow,
  PayrollValueKind,
} from './types';
import { requireJsonRecord, requirePresent } from './validation';

// The value, allocation and correction rows of a payroll export, built from
// its loaded sources. A missing employee mapping or an invalid source snapshot
// stops the export with its named error.

type PayrollEmployeeResult = PayrollExportSources['employeeResults'][number];
type PayrollExternalReferences = Map<
  string,
  PayrollExportSources['employeeMappings'][number]['external_employee_reference']
>;

export type PayrollExportRows = {
  valueRows: PayrollExportValueRow[];
  allocationRows: PayrollExportAllocationRow[];
  correctionRows: PayrollExportCorrectionRow[];
};

function isPayrollAccountEventKind(kind: string): kind is (typeof PAYROLL_ACCOUNT_EVENT_KINDS)[number] {
  return PAYROLL_ACCOUNT_EVENT_KINDS.some((payrollKind) => payrollKind === kind);
}

/** Every row of the export, each list sorted by row id. */
export function buildPayrollExportRows(
  sources: PayrollExportSources,
  period: { period_start_date: string; period_end_date: string },
): PayrollExportRows {
  const { calculation, employeeMappings, codeMappings, employeeResults, employeeIds } = sources;
  const { dailyResults, resultSources, accountEvents, correctionRequests, correctionApplications } = sources;
  const externalByEmployee = new Map(
    (employeeMappings ?? []).map((mapping) => [
      mapping.employee_record_id,
      mapping.external_employee_reference,
    ]),
  );
  for (const employeeId of employeeIds) {
    if (!externalByEmployee.get(employeeId)?.trim()) throw new Error('payroll_employee_mapping_missing');
  }
  const codeByKey = new Map(
    (codeMappings ?? []).map((mapping) => [
      `${mapping.value_kind}|${mapping.activity_kind ?? ''}`,
      mapping.output_code,
    ]),
  );
  const resultById = new Map((employeeResults ?? []).map((result) => [result.id, result]));
  const resultByEmployeeRecordId = new Map(
    (employeeResults ?? []).map((result) => [result.employee_record_id, result]),
  );
  const dailyById = new Map((dailyResults ?? []).map((daily) => [daily.id, daily]));
  const requestEmployeeById = new Map(
    (correctionRequests ?? []).map((request) => [request.id, request.subject_employee_record_id]),
  );
  const outputCodeFor = (valueKind: string, activityKind = ''): string =>
    codeByKey.get(`${valueKind}|${activityKind}`) ?? codeByKey.get(`${valueKind}|`) ?? '';
  const valueRows = buildPayrollValueRows({
    calculation,
    period,
    dailyResults,
    employeeResults,
    accountEvents,
    resultById,
    resultByEmployeeRecordId,
    externalByEmployee,
    outputCodeFor,
  });
  const allocationRows = buildPayrollAllocationRows({
    resultSources,
    dailyById,
    resultById,
    externalByEmployee,
  });
  const correctionRows = buildPayrollCorrectionRows({ correctionApplications, requestEmployeeById, period });
  valueRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  allocationRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  correctionRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  return { valueRows, allocationRows, correctionRows };
}

type PayrollValueInput = {
  rowId: string;
  employeeRecordId: string;
  localDate: string;
  valueKind: PayrollValueKind;
  activityKind?: string;
  sourceSeconds?: number;
  minutes: number;
  roundingDeltaSeconds?: number;
  policyVersionId: string;
};

type AppendPayrollValue = (input: PayrollValueInput) => void;

function buildPayrollValueRows(input: {
  calculation: { version: number };
  period: { period_end_date: string };
  dailyResults: PayrollExportSources['dailyResults'];
  employeeResults: PayrollExportSources['employeeResults'];
  accountEvents: PayrollExportSources['accountEvents'];
  resultById: Map<string, PayrollEmployeeResult>;
  resultByEmployeeRecordId: Map<string, PayrollEmployeeResult>;
  externalByEmployee: PayrollExternalReferences;
  outputCodeFor: (valueKind: string, activityKind?: string) => string;
}): PayrollExportValueRow[] {
  const { calculation, period, dailyResults, employeeResults, accountEvents } = input;
  const { resultById, resultByEmployeeRecordId, externalByEmployee, outputCodeFor } = input;
  const valueRows: PayrollExportValueRow[] = [];
  const appendValue: AppendPayrollValue = (input) => {
    if (input.minutes === 0 && (input.sourceSeconds ?? 0) === 0) return;
    valueRows.push({
      rowId: input.rowId,
      employeeRecordId: input.employeeRecordId,
      externalEmployeeReference: requirePresent(
        externalByEmployee.get(input.employeeRecordId),
        'payroll_employee_mapping_missing',
      ),
      localDate: input.localDate,
      valueKind: input.valueKind,
      outputCode: outputCodeFor(input.valueKind, input.activityKind),
      sourceSeconds: input.sourceSeconds ?? 0,
      minutes: input.minutes,
      roundingDeltaSeconds: input.roundingDeltaSeconds ?? 0,
      policyVersionId: input.policyVersionId,
      calculationVersion: calculation.version,
    });
  };
  appendDailyValues(dailyResults, resultById, appendValue);
  appendEmployeeResultValues(employeeResults, period, appendValue);
  appendAccountEventValues(accountEvents, resultByEmployeeRecordId, appendValue);
  return valueRows;
}

function appendDailyValues(
  dailyResults: PayrollExportSources['dailyResults'],
  resultById: Map<string, PayrollEmployeeResult>,
  appendValue: AppendPayrollValue,
): void {
  for (const daily of dailyResults ?? []) {
    const result = resultById.get(daily.employee_result_id);
    if (!result) continue;
    const common = {
      employeeRecordId: daily.employee_record_id,
      localDate: daily.local_date,
      policyVersionId: result.policy_version_id ?? '',
    };
    appendValue({
      ...common,
      rowId: `${daily.id}:source`,
      valueKind: 'source_attendance',
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.source_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:effective`,
      valueKind: 'effective_attendance',
      sourceSeconds: Number(daily.credited_seconds),
      minutes: daily.credited_minutes,
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:credited`,
      valueKind: 'credited_activity',
      activityKind: daily.activity_kind,
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.credited_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    for (const [valueKind, minutes] of [
      ['vacation', daily.vacation_minutes],
      ['sickness', daily.sickness_minutes],
      ['night_supplement', daily.night_minutes],
      ['sunday_supplement', daily.sunday_minutes],
      ['public_holiday_supplement', daily.public_holiday_minutes],
    ] as const)
      appendValue({
        ...common,
        rowId: `${daily.id}:${valueKind}`,
        valueKind,
        minutes,
      });
  }
}

function appendEmployeeResultValues(
  employeeResults: PayrollExportSources['employeeResults'],
  period: { period_end_date: string },
  appendValue: AppendPayrollValue,
): void {
  for (const result of employeeResults ?? []) {
    const common = {
      employeeRecordId: result.employee_record_id,
      localDate: period.period_end_date,
      policyVersionId: result.policy_version_id ?? '',
    };
    appendValue({
      ...common,
      rowId: `${result.id}:target`,
      valueKind: 'target',
      minutes: result.target_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:overtime`,
      valueKind: 'overtime',
      minutes: result.overtime_candidate_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:opening`,
      valueKind: 'opening_balance',
      minutes: result.previous_balance_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:closing`,
      valueKind: 'closing_balance',
      minutes: result.closing_balance_minutes,
    });
  }
}

function appendAccountEventValues(
  accountEvents: PayrollExportSources['accountEvents'],
  resultByEmployeeRecordId: Map<string, PayrollEmployeeResult>,
  appendValue: AppendPayrollValue,
): void {
  for (const event of accountEvents ?? []) {
    if (!isPayrollAccountEventKind(event.event_kind)) continue;
    const result = resultByEmployeeRecordId.get(event.employee_record_id);
    appendValue({
      rowId: `${event.id}:${event.event_kind}`,
      employeeRecordId: event.employee_record_id,
      localDate: event.effective_date,
      valueKind: event.event_kind,
      minutes: event.minutes,
      policyVersionId: result?.policy_version_id ?? '',
    });
  }
}

function buildPayrollAllocationRows(input: {
  resultSources: PayrollExportSources['resultSources'];
  dailyById: Map<string, PayrollExportSources['dailyResults'][number]>;
  resultById: Map<string, PayrollEmployeeResult>;
  externalByEmployee: PayrollExternalReferences;
}): PayrollExportAllocationRow[] {
  const { resultSources, dailyById, resultById, externalByEmployee } = input;
  const allocationMinutesBySourceId = new Map<string, number>();
  const sourcesByDailyResultId = new Map<string, Array<NonNullable<typeof resultSources>[number]>>();
  for (const source of resultSources ?? []) {
    if (!source.daily_result_id) continue;
    const list = sourcesByDailyResultId.get(source.daily_result_id) ?? [];
    list.push(source);
    sourcesByDailyResultId.set(source.daily_result_id, list);
  }
  for (const [dailyResultId, dailySources] of sourcesByDailyResultId) {
    const daily = dailyById.get(dailyResultId);
    if (!daily) continue;
    const distribution = distributeCreditedMinutes(
      dailySources.map((source) => ({
        id: source.id,
        sourceSeconds: Number(
          requireJsonRecord(source.source_snapshot, 'period_source_snapshot_invalid').sourceSeconds ?? 0,
        ),
      })),
      daily.credited_minutes,
    );
    for (const [sourceId, minutes] of distribution) allocationMinutesBySourceId.set(sourceId, minutes);
  }
  const allocationRows: PayrollExportAllocationRow[] = (resultSources ?? []).flatMap((source) => {
    if (!source.daily_result_id) return [];
    const daily = dailyById.get(source.daily_result_id);
    const result = resultById.get(source.employee_result_id);
    if (!daily || !result) return [];
    const snapshot = requireJsonRecord(source.source_snapshot, 'period_source_snapshot_invalid');
    const sourceSeconds = Number(snapshot.sourceSeconds ?? 0);
    const creditedMinutes = allocationMinutesBySourceId.get(source.id) ?? 0;
    return [
      {
        rowId: source.id,
        employeeRecordId: result.employee_record_id,
        externalEmployeeReference: requirePresent(
          externalByEmployee.get(result.employee_record_id),
          'payroll_employee_mapping_missing',
        ),
        localDate: daily.local_date,
        activityKind: daily.activity_kind,
        sourceReference: `${source.source_kind}:${source.source_id ?? source.source_key}`,
        sourceSeconds,
        creditedMinutes,
        allocationKind: String(snapshot.allocationKind ?? 'unallocated'),
        jobNumber: String(snapshot.jobNumber ?? ''),
        projectNumber: String(snapshot.projectNumber ?? ''),
      },
    ];
  });
  return allocationRows;
}

function buildPayrollCorrectionRows(input: {
  correctionApplications: PayrollExportSources['correctionApplications'];
  requestEmployeeById: Map<
    string,
    PayrollExportSources['correctionRequests'][number]['subject_employee_record_id']
  >;
  period: { period_start_date: string; period_end_date: string };
}): PayrollExportCorrectionRow[] {
  const { correctionApplications, requestEmployeeById, period } = input;
  // Facts carry any ISO offset; compare instants, not strings. Start inclusive, end exclusive.
  const periodStart = Date.parse(getBerlinInstant(`${period.period_start_date}T00:00`));
  const periodEnd = Date.parse(getBerlinInstant(`${addLocalDays(period.period_end_date, 1)}T00:00`));
  const correctionRows: PayrollExportCorrectionRow[] = (correctionApplications ?? []).flatMap(
    (application) => {
      const employeeRecordId = requestEmployeeById.get(application.request_id);
      const snapshot: unknown = application.applied_snapshot;
      const facts: unknown[] = isJsonRecord(snapshot) && Array.isArray(snapshot.facts) ? snapshot.facts : [];
      const affectsPeriod = facts.some((fact) => {
        if (!isJsonRecord(fact) || typeof fact.timestamp !== 'string') return false;
        const instant = Date.parse(fact.timestamp);
        return instant >= periodStart && instant < periodEnd;
      });
      if (!employeeRecordId || !affectsPeriod) return [];
      return [
        {
          rowId: application.id,
          employeeRecordId,
          requestId: application.request_id,
          revision: Number(application.revision),
          applicationId: application.id,
          sourceFingerprint: application.source_fingerprint,
        },
      ];
    },
  );
  return correctionRows;
}
