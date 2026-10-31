import 'server-only';

import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { jsonRecordOrEmpty } from '@/lib/supabase/json';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { readTimeAccountManagement, requireAuth } from './access';
import {
  type PendingAdjustment,
  readDecidableRecordIds,
  readLatestFindingDecisions,
  readPendingAdjustments,
} from './decision-reads';
import { canCorrectOpeningDate } from './opening-dates';
import { type OpeningDateCorrection, type OpeningDateFacts, readOpeningDateFacts } from './opening-reads';
import { getBerlinInstant, PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-sources';
import type {
  PayrollExportState,
  TimeFindingDecision,
  TimeFindingKind,
  TimePeriodState,
} from './presentation';
import {
  byEmployeeName,
  mapEmployeeNames,
  type NamedEmployee,
  type NamedProfile,
  readEmployeeNames,
  readProfiles,
  readRegion,
  requireRead,
  type ReaderContext,
  type TimeAccountRead,
} from './read-support';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type TimePeriodListItem = {
  id: string;
  startDate: string;
  endDate: string;
  state: TimePeriodState;
  calculationVersion: number | null;
  employeeCount: number;
  findingCount: number;
  blockingCount: number;
  closeVersion: number | null;
};

/** A time session without an end that started before the end of a period. */
export type OpenPeriodSession = {
  employeeRecordId: string;
  employeeName: string;
  startedAt: string;
  status: 'open' | 'recovery_required';
};

export type TimePeriodDetail = {
  period: { id: string; startDate: string; endDate: string; state: TimePeriodState };
  calculation: {
    id: string;
    version: number;
    sourceFingerprint: string;
  } | null;
  results: Array<{
    employeeRecordId: string;
    employeeName: string;
    targetMinutes: number;
    creditedMinutes: number;
    periodDeltaMinutes: number;
    closingBalanceMinutes: number;
    authoritativeTargets: boolean;
  }>;
  findings: Array<{
    id: string;
    employeeRecordId: string | null;
    employeeName: string | null;
    kind: TimeFindingKind;
    severity: string;
    explanation: Record<string, unknown>;
    decision: TimeFindingDecision | null;
    /** The caller may decide it: an organization-wide finding, or a person in their approval scope. */
    canApprove: boolean;
  }>;
  /** Live, not from the calculation: the database refuses the close while one exists. */
  openSessions: OpenPeriodSession[];
  exports: Array<{
    id: string;
    version: number;
    state: PayrollExportState;
    documentId: string | null;
    createdAt: string;
  }>;
};

export type TimeAccountSettingsData = {
  policies: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    version: number;
    effectiveFrom: string | null;
  }>;
  employeeCount: number;
  openAccountCount: number;
  mappingVersion: number | null;
  /** The first day of the oldest month without a closed period: the proposed rule and account start. */
  suggestedStartDate: string;
  missingAccounts: Array<{ employeeRecordId: string; employeeName: string }>;
  employees: Array<{
    employeeRecordId: string;
    employeeName: string;
    assignedPolicyId: string | null;
  }>;
  accounts: Array<{
    id: string;
    employeeRecordId: string;
    employeeName: string;
    currentBalanceMinutes: number;
    version: number;
    openedOn: string;
    /** No closed period ends on or after the opening date, so it may still be corrected. */
    canCorrectOpenedOn: boolean;
    openingCorrections: OpeningDateCorrection[];
  }>;
  pendingAdjustments: Array<Omit<PendingAdjustment, 'employeeRecordId'> & { employeeName: string }>;
};

/**
 * Every session of the organization without an end that started before the
 * end of the period, with the employee's name. A failed read throws.
 */
export async function readOpenPeriodSessions(
  admin: SupabaseAdmin,
  organizationId: string,
  periodEndDate: string,
): Promise<OpenPeriodSession[]> {
  const endInstant = getBerlinInstant(`${addLocalDays(periodEndDate, 1)}T00:00`);
  // One open session per employee (unique index), so the organization bounds the rows.
  const { data: sessions } = requirePeriodRows(
    await readCompleteRows(
      (from, to) =>
        admin
          .from('time_sessions')
          .select('id, employee_record_id, status, started_at')
          .eq('organization_id', organizationId)
          .is('ended_at', null)
          .lt('started_at', endInstant)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ),
  );
  if (sessions.length === 0) return [];
  const names = await readEmployeeNames(
    admin,
    organizationId,
    sessions.map((session) => session.employee_record_id),
  );
  return sessions
    .map((session) => ({
      employeeRecordId: session.employee_record_id,
      employeeName: names.get(session.employee_record_id) ?? 'Unbekannt',
      startedAt: session.started_at,
      status: session.status === 'recovery_required' ? ('recovery_required' as const) : ('open' as const),
    }))
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'de'));
}
export async function getTimePeriods(): Promise<TimeAccountRead<TimePeriodListItem[]>> {
  const context = await requireAuth();
  const management = await readTimeAccountManagement(context);
  if (!management.success) return { success: false, error: 'read_failed' };
  if (!management.canManage) return { success: true, data: [] };
  return readRegion('getTimePeriods: period list failed', () => readTimePeriodList(context));
}

type PeriodListRow = Pick<
  Tables<'time_periods'>,
  | 'id'
  | 'period_start_date'
  | 'period_end_date'
  | 'state'
  | 'current_calculation_id'
  | 'current_close_version_id'
>;

async function readTimePeriodList(context: ReaderContext): Promise<TimePeriodListItem[]> {
  const admin = createSupabaseAdminClient();
  const periods = requireRead(
    await admin
      .from('time_periods')
      .select(
        'id, period_start_date, period_end_date, state, current_calculation_id, current_close_version_id',
      )
      .eq('organization_id', context.orgId)
      .order('period_start_date', { ascending: false }),
  );
  const calculationIds = periods.flatMap((period) =>
    period.current_calculation_id ? [period.current_calculation_id] : [],
  );
  const closeIds = periods.flatMap((period) =>
    period.current_close_version_id ? [period.current_close_version_id] : [],
  );
  const [calculations, results, findings, closes] = await Promise.all([
    readInBatches(calculationIds, (batch) =>
      admin
        .from('time_period_calculations')
        .select('id, version')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ).then(requirePeriodRows),
    // One row per employee and period: a batch of periods exceeds 1,000 rows.
    readInBatches(calculationIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_employee_results')
            .select('calculation_id')
            .eq('organization_id', context.orgId)
            .in('calculation_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(calculationIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_findings')
            .select('calculation_id, severity')
            .eq('organization_id', context.orgId)
            .in('calculation_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(closeIds, (batch) =>
      admin
        .from('time_period_close_versions')
        .select('id, version')
        .eq('organization_id', context.orgId)
        .in('id', [...batch]),
    ).then(requirePeriodRows),
  ]);
  return toTimePeriodListItems(periods, {
    calculations: calculations.data,
    results: results.data,
    findings: findings.data,
    closes: closes.data,
  });
}

function toTimePeriodListItems(
  periods: readonly PeriodListRow[],
  rows: {
    calculations: readonly Pick<Tables<'time_period_calculations'>, 'id' | 'version'>[];
    results: readonly Pick<Tables<'time_period_employee_results'>, 'calculation_id'>[];
    findings: readonly Pick<Tables<'time_period_findings'>, 'calculation_id' | 'severity'>[];
    closes: readonly Pick<Tables<'time_period_close_versions'>, 'id' | 'version'>[];
  },
): TimePeriodListItem[] {
  const calculationVersionById = new Map(rows.calculations.map((item) => [item.id, item.version]));
  const closeVersionById = new Map(rows.closes.map((item) => [item.id, item.version]));
  const employeeCountByCalculationId = new Map<string, number>();
  for (const result of rows.results)
    employeeCountByCalculationId.set(
      result.calculation_id,
      (employeeCountByCalculationId.get(result.calculation_id) ?? 0) + 1,
    );
  const findingsByCalculationId = new Map<string, Array<(typeof rows.findings)[number]>>();
  for (const finding of rows.findings) {
    const list = findingsByCalculationId.get(finding.calculation_id) ?? [];
    list.push(finding);
    findingsByCalculationId.set(finding.calculation_id, list);
  }
  return periods.map((period) => {
    const periodFindings = period.current_calculation_id
      ? (findingsByCalculationId.get(period.current_calculation_id) ?? [])
      : [];
    return {
      id: period.id,
      startDate: period.period_start_date,
      endDate: period.period_end_date,
      state: period.state,
      calculationVersion: period.current_calculation_id
        ? (calculationVersionById.get(period.current_calculation_id) ?? null)
        : null,
      employeeCount: period.current_calculation_id
        ? (employeeCountByCalculationId.get(period.current_calculation_id) ?? 0)
        : 0,
      findingCount: periodFindings.length,
      blockingCount: periodFindings.filter((finding) => finding.severity === 'close_blocked').length,
      closeVersion: period.current_close_version_id
        ? (closeVersionById.get(period.current_close_version_id) ?? null)
        : null,
    };
  });
}

/** `data: null` means no such period for this caller: the page answers 404. */
export async function getTimePeriodDetail(
  periodIdInput: string,
): Promise<TimeAccountRead<TimePeriodDetail | null>> {
  const parsedPeriodId = uuidSchema.safeParse(periodIdInput);
  if (!parsedPeriodId.success) return { success: true, data: null };
  const periodId = parsedPeriodId.data;
  const context = await requireAuth();
  const management = await readTimeAccountManagement(context);
  if (!management.success) return { success: false, error: 'read_failed' };
  if (!management.canManage) return { success: true, data: null };
  return readRegion('getTimePeriodDetail: period detail failed', () =>
    readTimePeriodDetail(context, periodId),
  );
}

type PeriodDetailRow = Pick<
  Tables<'time_periods'>,
  'id' | 'period_start_date' | 'period_end_date' | 'state' | 'current_calculation_id'
>;
type PeriodDetailCalculation = Pick<
  Tables<'time_period_calculations'>,
  'id' | 'version' | 'source_fingerprint'
>;
type PeriodDetailRows = {
  results: Tables<'time_period_employee_results'>[];
  findings: Tables<'time_period_findings'>[];
  exports: Pick<Tables<'payroll_exports'>, 'id' | 'version' | 'state' | 'document_id' | 'created_at'>[];
  openSessions: OpenPeriodSession[];
};

async function readTimePeriodDetail(
  context: ReaderContext,
  periodId: string,
): Promise<TimePeriodDetail | null> {
  const admin = createSupabaseAdminClient();
  const period = requireRead(
    await admin
      .from('time_periods')
      .select('id, period_start_date, period_end_date, state, current_calculation_id')
      .eq('organization_id', context.orgId)
      .eq('id', periodId)
      .maybeSingle(),
  );
  if (!period) return null;
  const calculation = period.current_calculation_id
    ? requireRead(
        await admin
          .from('time_period_calculations')
          .select('id, version, source_fingerprint')
          .eq('organization_id', context.orgId)
          .eq('id', period.current_calculation_id)
          .single(),
      )
    : null;
  const rows = await readPeriodDetailRows(admin, context, { periodId, period, calculation });
  const findingRecordIds = [
    ...new Set(
      rows.findings.flatMap((finding) => (finding.employee_record_id ? [finding.employee_record_id] : [])),
    ),
  ];
  const [nameByEmployee, decisionByFinding, decidableRecordIds] = await Promise.all([
    readEmployeeNames(admin, context.orgId, [
      ...rows.results.map((result) => result.employee_record_id),
      ...findingRecordIds,
    ]),
    readLatestFindingDecisions(
      admin,
      context.orgId,
      rows.findings.map((finding) => finding.id),
    ),
    readDecidableRecordIds(context, findingRecordIds),
  ]);
  return toTimePeriodDetail({
    period,
    calculation,
    rows,
    nameByEmployee,
    decisionByFinding,
    decidableRecordIds,
  });
}

// The results, findings and exports of the period, and its live open sessions.
async function readPeriodDetailRows(
  admin: SupabaseAdmin,
  context: ReaderContext,
  target: { periodId: string; period: PeriodDetailRow; calculation: PeriodDetailCalculation | null },
): Promise<PeriodDetailRows> {
  const { periodId, period, calculation } = target;
  const [{ data: results }, { data: findings }, exports, openSessions] = await Promise.all([
    calculation
      ? readCompleteRows(
          (from, to) =>
            admin
              .from('time_period_employee_results')
              .select('*')
              .eq('organization_id', context.orgId)
              .eq('calculation_id', calculation.id)
              .order('id')
              .range(from, to),
          PERIOD_SOURCE_ROW_CAP,
        ).then(requirePeriodRows)
      : Promise.resolve({ data: [] }),
    calculation
      ? readCompleteRows(
          (from, to) =>
            admin
              .from('time_period_findings')
              .select('*')
              .eq('organization_id', context.orgId)
              .eq('calculation_id', calculation.id)
              .order('id')
              .range(from, to),
          PERIOD_SOURCE_ROW_CAP,
        ).then(requirePeriodRows)
      : Promise.resolve({ data: [] }),
    admin
      .from('payroll_exports')
      .select('id, version, state, document_id, created_at')
      .eq('organization_id', context.orgId)
      .eq('period_id', periodId)
      .order('version', { ascending: false })
      .then(requireRead),
    period.state === 'closed'
      ? Promise.resolve([])
      : readOpenPeriodSessions(admin, context.orgId, period.period_end_date),
  ]);
  return { results, findings, exports, openSessions };
}

function toTimePeriodDetail(input: {
  period: PeriodDetailRow;
  calculation: PeriodDetailCalculation | null;
  rows: PeriodDetailRows;
  nameByEmployee: Map<string, string>;
  decisionByFinding: Map<string, TimeFindingDecision>;
  decidableRecordIds: Set<string>;
}): TimePeriodDetail {
  const { period, calculation, rows, nameByEmployee, decisionByFinding, decidableRecordIds } = input;
  return {
    period: {
      id: period.id,
      startDate: period.period_start_date,
      endDate: period.period_end_date,
      state: period.state,
    },
    calculation: calculation
      ? {
          id: calculation.id,
          version: calculation.version,
          sourceFingerprint: calculation.source_fingerprint,
        }
      : null,
    results: rows.results.map((result) => ({
      employeeRecordId: result.employee_record_id,
      employeeName: nameByEmployee.get(result.employee_record_id) ?? 'Unbekannt',
      targetMinutes: result.target_minutes,
      creditedMinutes: result.credited_minutes,
      periodDeltaMinutes: result.period_delta_minutes,
      closingBalanceMinutes: result.closing_balance_minutes,
      authoritativeTargets: result.authoritative_targets,
    })),
    findings: rows.findings.map((finding) => ({
      id: finding.id,
      employeeRecordId: finding.employee_record_id,
      employeeName: finding.employee_record_id
        ? (nameByEmployee.get(finding.employee_record_id) ?? 'Unbekannt')
        : null,
      kind: finding.finding_kind,
      severity: finding.severity,
      explanation: jsonRecordOrEmpty(finding.explanation),
      decision: decisionByFinding.get(finding.id) ?? null,
      canApprove: finding.employee_record_id === null || decidableRecordIds.has(finding.employee_record_id),
    })),
    openSessions: rows.openSessions,
    exports: rows.exports.map((item) => ({
      id: item.id,
      version: item.version,
      state: item.state,
      documentId: item.document_id,
      createdAt: item.created_at,
    })),
  };
}

const EMPTY_TIME_ACCOUNT_SETTINGS: Omit<TimeAccountSettingsData, 'suggestedStartDate'> = {
  policies: [],
  employeeCount: 0,
  openAccountCount: 0,
  mappingVersion: null,
  missingAccounts: [],
  employees: [],
  accounts: [],
  pendingAdjustments: [],
};

export async function getTimeAccountSettings(): Promise<TimeAccountRead<TimeAccountSettingsData>> {
  const context = await requireAuth();
  if (context.role !== 'admin' && context.role !== 'buero')
    return {
      success: true,
      data: { ...EMPTY_TIME_ACCOUNT_SETTINGS, suggestedStartDate: getBusinessTodayIso() },
    };
  return readRegion('getTimeAccountSettings: settings failed', () => readTimeAccountSettings(context));
}

type SettingsRows = {
  policies: Pick<Tables<'time_account_policies'>, 'id' | 'name' | 'is_default' | 'version'>[];
  employees: NamedEmployee[];
  accounts: Pick<
    Tables<'time_accounts'>,
    'id' | 'employee_record_id' | 'current_balance_minutes' | 'version' | 'opened_on'
  >[];
  mapping: Pick<Tables<'payroll_mapping_profiles'>, 'current_version_id'> | null;
  assignments: Pick<
    Tables<'time_account_policy_assignments'>,
    'employee_record_id' | 'policy_id' | 'valid_from' | 'valid_until'
  >[];
  pending: PendingAdjustment[];
};
type SettingsDetails = {
  profiles: NamedProfile[];
  versions: Pick<Tables<'time_account_policy_versions'>, 'policy_id' | 'effective_from' | 'version'>[];
  mappingVersion: number | null;
  openingDates: OpeningDateFacts;
};

async function readTimeAccountSettings(context: ReaderContext): Promise<TimeAccountSettingsData> {
  const admin = createSupabaseAdminClient();
  const today = getBusinessTodayIso();
  const rows = await readSettingsRows(admin, context, today);
  const [profiles, { data: versions }, mappingVersion, openingDates] = await Promise.all([
    readProfiles(admin, rows.employees),
    readInBatches(
      rows.policies.map((policy) => policy.id),
      (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('time_account_policy_versions')
              .select('policy_id, effective_from, version')
              .eq('organization_id', context.orgId)
              .in('policy_id', [...batch])
              .order('version', { ascending: false })
              .order('id')
              .range(from, to),
          PERIOD_SOURCE_ROW_CAP,
        ),
    ).then(requirePeriodRows),
    rows.mapping?.current_version_id
      ? admin
          .from('payroll_mapping_versions')
          .select('version')
          .eq('organization_id', context.orgId)
          .eq('id', rows.mapping.current_version_id)
          .single()
          .then(requireRead)
          .then((version) => version.version)
      : Promise.resolve(null),
    readOpeningDateFacts(admin, context, today),
  ]);
  return toTimeAccountSettings(rows, { profiles, versions, mappingVersion, openingDates });
}

// The organization's policies, employees, accounts, mapping profile, today's
// policy assignments and pending adjustments.
async function readSettingsRows(
  admin: SupabaseAdmin,
  context: ReaderContext,
  today: string,
): Promise<SettingsRows> {
  const [policies, { data: employees }, { data: accounts }, mapping, { data: assignments }, pending] =
    await Promise.all([
      admin
        .from('time_account_policies')
        .select('id, name, is_default, version')
        .eq('organization_id', context.orgId)
        .order('created_at')
        .then(requireRead),
      readCompleteRows(
        (from, to) =>
          admin
            .from('employee_records')
            .select('id, user_id, first_name, last_name')
            .eq('organization_id', context.orgId)
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ).then(requirePeriodRows),
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_accounts')
            .select('id, employee_record_id, current_balance_minutes, version, opened_on')
            .eq('organization_id', context.orgId)
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ).then(requirePeriodRows),
      admin
        .from('payroll_mapping_profiles')
        .select('current_version_id')
        .eq('organization_id', context.orgId)
        .maybeSingle()
        .then(requireRead),
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_account_policy_assignments')
            .select('employee_record_id, policy_id, valid_from, valid_until')
            .eq('organization_id', context.orgId)
            .lte('valid_from', today)
            .or(`valid_until.is.null,valid_until.gte.${today}`)
            .order('valid_from', { ascending: false })
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ).then(requirePeriodRows),
      readPendingAdjustments(admin, context),
    ]);
  return { policies, employees, accounts, mapping, assignments, pending };
}

function toTimeAccountSettings(rows: SettingsRows, details: SettingsDetails): TimeAccountSettingsData {
  const { policies, employees, accounts, assignments, pending } = rows;
  const { profiles, versions, mappingVersion, openingDates } = details;
  const employeeNameById = mapEmployeeNames(employees, profiles);
  const nameOf = (id: string): string => employeeNameById.get(id) ?? 'Unbekannt';
  const employeesByName = byEmployeeName(employees, (employee) => employee.id, nameOf);
  const accountsByName = byEmployeeName(accounts, (account) => account.employee_record_id, nameOf);
  const openEmployeeIds = new Set(accounts.map((account) => account.employee_record_id));
  const assignedPolicyByEmployee = new Map<string, string>();
  for (const assignment of assignments)
    if (!assignedPolicyByEmployee.has(assignment.employee_record_id))
      assignedPolicyByEmployee.set(assignment.employee_record_id, assignment.policy_id);
  const latestByPolicy = new Map<string, { effective_from: string; version: number }>();
  for (const version of versions)
    if (!latestByPolicy.has(version.policy_id)) latestByPolicy.set(version.policy_id, version);
  return {
    policies: policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      isDefault: policy.is_default,
      version: latestByPolicy.get(policy.id)?.version ?? policy.version,
      effectiveFrom: latestByPolicy.get(policy.id)?.effective_from ?? null,
    })),
    employeeCount: employees.length,
    openAccountCount: accounts.length,
    mappingVersion,
    suggestedStartDate: openingDates.suggestedStartDate,
    missingAccounts: employeesByName
      .filter((employee) => !openEmployeeIds.has(employee.id))
      .map((employee) => ({ employeeRecordId: employee.id, employeeName: nameOf(employee.id) })),
    employees: employeesByName.map((employee) => ({
      employeeRecordId: employee.id,
      employeeName: nameOf(employee.id),
      assignedPolicyId: assignedPolicyByEmployee.get(employee.id) ?? null,
    })),
    accounts: accountsByName.map((account) => ({
      id: account.id,
      employeeRecordId: account.employee_record_id,
      employeeName: nameOf(account.employee_record_id),
      currentBalanceMinutes: account.current_balance_minutes,
      version: Number(account.version),
      openedOn: account.opened_on,
      canCorrectOpenedOn: canCorrectOpeningDate(account.opened_on, openingDates.latestClosedPeriodEnd),
      openingCorrections: openingDates.correctionsByAccount.get(account.id) ?? [],
    })),
    pendingAdjustments: pending.map(({ employeeRecordId, ...request }) => ({
      ...request,
      employeeName: nameOf(employeeRecordId),
    })),
  };
}
