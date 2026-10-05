import 'server-only';

import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { addLocalDays } from '@/lib/planning/date-time';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { readTimeAccountManagement, requireAuth } from './access';
import { getBerlinInstant, PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-preparation';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/** A page region's read: its data, or the stable code of a failed read. */
type TimeAccountRead<Data> = ActionResult<{ data: Data }>;

export type TimeAccountOverview = {
  account: {
    id: string;
    currentBalanceMinutes: number;
    openedOn: string;
  } | null;
  events: Array<{
    id: string;
    kind: string;
    effectiveDate: string;
    minutes: number;
    reason: string;
  }>;
  periods: Array<{
    id: string;
    startDate: string;
    endDate: string;
    state: string;
    targetMinutes: number;
    creditedMinutes: number;
    deltaMinutes: number;
    closingBalanceMinutes: number;
  }>;
  /** More account events exist than `events` shows. */
  hasMoreEvents: boolean;
  /** More periods exist than `periods` covers. */
  hasMorePeriods: boolean;
};

/** The overview shows the newest events and periods and reports when older ones exist. */
export const OVERVIEW_EVENT_LIMIT = 50;
export const OVERVIEW_PERIOD_LIMIT = 24;

export type TimePeriodListItem = {
  id: string;
  startDate: string;
  endDate: string;
  state: string;
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
  period: { id: string; startDate: string; endDate: string; state: string };
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
    kind: string;
    severity: string;
    explanation: Record<string, unknown>;
    decision: string | null;
  }>;
  /** Live, not from the calculation: the database refuses the close while one exists. */
  openSessions: OpenPeriodSession[];
  exports: Array<{
    id: string;
    version: number;
    state: string;
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
  }>;
  pendingAdjustments: Array<{
    id: string;
    employeeName: string;
    kind: 'manual_adjustment' | 'expiry' | 'payout';
    minutes: number;
    effectiveDate: string;
    reason: string;
    version: number;
  }>;
};

// A failed read throws inside a reader and becomes `read_failed` here, so a
// page shows a retry instead of an empty account, list or period.
async function readRegion<Data>(label: string, read: () => Promise<Data>): Promise<TimeAccountRead<Data>> {
  try {
    return { success: true, data: await read() };
  } catch (error) {
    logReadFailure(label, error);
    return { success: false, error: 'read_failed' };
  }
}

function requireRead<Data>(result: PostgrestSingleResponse<Data>): Data {
  if (result.error) throw result.error;
  return result.data;
}

type NamedEmployee = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};
type NamedProfile = { id: string; first_name: string | null; last_name: string | null };

// The profile name wins over the personnel record, as everywhere in Zeiterfassung.
function mapEmployeeNames(
  employees: readonly NamedEmployee[],
  profiles: readonly NamedProfile[],
): Map<string, string> {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return new Map(
    employees.map((employee) => {
      const profile = employee.user_id ? profileById.get(employee.user_id) : undefined;
      const name =
        [profile?.first_name ?? employee.first_name, profile?.last_name ?? employee.last_name]
          .filter(Boolean)
          .join(' ') || 'Unbekannt';
      return [employee.id, name];
    }),
  );
}

async function readProfiles(
  admin: SupabaseAdmin,
  employees: readonly NamedEmployee[],
): Promise<NamedProfile[]> {
  const userIds = employees.flatMap((employee) => (employee.user_id ? [employee.user_id] : []));
  const { data: profiles } = requirePeriodRows(
    await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  );
  return profiles;
}

async function readEmployeeNames(
  admin: SupabaseAdmin,
  organizationId: string,
  employeeIds: readonly string[],
): Promise<Map<string, string>> {
  const { data: employees } = requirePeriodRows(
    await readInBatches([...new Set(employeeIds)], (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  );
  return mapEmployeeNames(employees, await readProfiles(admin, employees));
}

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

export async function getTimeAccountOverview(): Promise<TimeAccountRead<TimeAccountOverview>> {
  const context = await requireAuth();
  return readRegion('getTimeAccountOverview: account overview failed', async () => {
    const admin = createSupabaseAdminClient();
    const employee = requireRead(
      await admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .maybeSingle(),
    );
    if (!employee)
      return { account: null, events: [], periods: [], hasMoreEvents: false, hasMorePeriods: false };
    const [accountResult, periodResult] = await Promise.all([
      admin
        .from('time_accounts')
        .select('id, opened_on, current_balance_minutes')
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', employee.id)
        .maybeSingle(),
      admin
        .from('time_periods')
        .select('id, period_start_date, period_end_date, state, current_calculation_id')
        .eq('organization_id', context.orgId)
        .not('current_calculation_id', 'is', null)
        .order('period_start_date', { ascending: false })
        .limit(OVERVIEW_PERIOD_LIMIT + 1),
    ]);
    const account = requireRead(accountResult);
    const periodRows = requireRead(periodResult);
    const periods = periodRows.slice(0, OVERVIEW_PERIOD_LIMIT);
    const currentCalculationIds = periods.flatMap((period) =>
      period.current_calculation_id ? [period.current_calculation_id] : [],
    );
    const [{ data: results }, events] = await Promise.all([
      readInBatches(currentCalculationIds, (batch) =>
        admin
          .from('time_period_employee_results')
          .select(
            'target_minutes, credited_minutes, period_delta_minutes, closing_balance_minutes, calculation_id',
          )
          .eq('organization_id', context.orgId)
          .eq('employee_record_id', employee.id)
          .in('calculation_id', [...batch]),
      ).then(requirePeriodRows),
      account
        ? admin
            .from('time_account_events')
            .select('id, event_kind, effective_date, minutes, reason')
            .eq('organization_id', context.orgId)
            .eq('account_id', account.id)
            .order('effective_date', { ascending: false })
            .order('id')
            .limit(OVERVIEW_EVENT_LIMIT + 1)
            .then(requireRead)
        : Promise.resolve([]),
    ]);
    const periodByCalculation = new Map(
      periods.flatMap((period) =>
        period.current_calculation_id ? [[period.current_calculation_id, period] as const] : [],
      ),
    );
    return {
      account: account
        ? {
            id: account.id,
            currentBalanceMinutes: account.current_balance_minutes,
            openedOn: account.opened_on,
          }
        : null,
      hasMoreEvents: events.length > OVERVIEW_EVENT_LIMIT,
      hasMorePeriods: periodRows.length > OVERVIEW_PERIOD_LIMIT,
      events: events.slice(0, OVERVIEW_EVENT_LIMIT).map((event) => ({
        id: event.id,
        kind: event.event_kind,
        effectiveDate: event.effective_date,
        minutes: event.minutes,
        reason: event.reason,
      })),
      periods: results.flatMap((result) => {
        const period = periodByCalculation.get(result.calculation_id);
        return period
          ? [
              {
                id: period.id,
                startDate: period.period_start_date,
                endDate: period.period_end_date,
                state: period.state,
                targetMinutes: result.target_minutes,
                creditedMinutes: result.credited_minutes,
                deltaMinutes: result.period_delta_minutes,
                closingBalanceMinutes: result.closing_balance_minutes,
              },
            ]
          : [];
      }),
    };
  });
}

export async function getTimePeriods(): Promise<TimeAccountRead<TimePeriodListItem[]>> {
  const context = await requireAuth();
  const management = await readTimeAccountManagement(context);
  if (!management.success) return { success: false, error: 'read_failed' };
  if (!management.canManage) return { success: true, data: [] };
  return readRegion('getTimePeriods: period list failed', async () => {
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
    const calculationVersionById = new Map(calculations.data.map((item) => [item.id, item.version]));
    const closeVersionById = new Map(closes.data.map((item) => [item.id, item.version]));
    const employeeCountByCalculationId = new Map<string, number>();
    for (const result of results.data)
      employeeCountByCalculationId.set(
        result.calculation_id,
        (employeeCountByCalculationId.get(result.calculation_id) ?? 0) + 1,
      );
    const findingsByCalculationId = new Map<string, typeof findings.data>();
    for (const finding of findings.data) {
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
  return readRegion('getTimePeriodDetail: period detail failed', async () => {
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
    const nameByEmployee = await readEmployeeNames(admin, context.orgId, [
      ...results.map((result) => result.employee_record_id),
      ...findings.flatMap((finding) => (finding.employee_record_id ? [finding.employee_record_id] : [])),
    ]);
    // A finding sits in one batch, so its newest decision still comes first.
    const { data: decisions } = await readInBatches(
      findings.map((finding) => finding.id),
      (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('time_period_finding_decisions')
              .select('finding_id, decision, decided_at')
              .eq('organization_id', context.orgId)
              .in('finding_id', [...batch])
              .order('decided_at', { ascending: false })
              .order('id')
              .range(from, to),
          PERIOD_SOURCE_ROW_CAP,
        ),
    ).then(requirePeriodRows);
    const decisionByFinding = new Map<string, string>();
    for (const decision of decisions)
      if (!decisionByFinding.has(decision.finding_id))
        decisionByFinding.set(decision.finding_id, decision.decision);
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
      results: results.map((result) => ({
        employeeRecordId: result.employee_record_id,
        employeeName: nameByEmployee.get(result.employee_record_id) ?? 'Unbekannt',
        targetMinutes: result.target_minutes,
        creditedMinutes: result.credited_minutes,
        periodDeltaMinutes: result.period_delta_minutes,
        closingBalanceMinutes: result.closing_balance_minutes,
        authoritativeTargets: result.authoritative_targets,
      })),
      findings: findings.map((finding) => ({
        id: finding.id,
        employeeRecordId: finding.employee_record_id,
        employeeName: finding.employee_record_id
          ? (nameByEmployee.get(finding.employee_record_id) ?? 'Unbekannt')
          : null,
        kind: finding.finding_kind,
        severity: finding.severity,
        explanation: finding.explanation as Record<string, unknown>,
        decision: decisionByFinding.get(finding.id) ?? null,
      })),
      openSessions,
      exports: exports.map((item) => ({
        id: item.id,
        version: item.version,
        state: item.state,
        documentId: item.document_id,
        createdAt: item.created_at,
      })),
    };
  });
}

const EMPTY_TIME_ACCOUNT_SETTINGS: TimeAccountSettingsData = {
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
    return { success: true, data: EMPTY_TIME_ACCOUNT_SETTINGS };
  return readRegion('getTimeAccountSettings: settings failed', async () => {
    const admin = createSupabaseAdminClient();
    const today = getBusinessTodayIso();
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
              .select('id, employee_record_id, current_balance_minutes, version')
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
        readCompleteRows(
          (from, to) =>
            admin
              .from('time_account_adjustment_requests')
              .select('id, employee_record_id, adjustment_kind, minutes, effective_date, reason, version')
              .eq('organization_id', context.orgId)
              .eq('status', 'submitted')
              .order('created_at')
              .order('id')
              .range(from, to),
          PERIOD_SOURCE_ROW_CAP,
        ).then(requirePeriodRows),
      ]);
    const [profiles, { data: versions }, mappingVersion] = await Promise.all([
      readProfiles(admin, employees),
      readInBatches(
        policies.map((policy) => policy.id),
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
      mapping?.current_version_id
        ? admin
            .from('payroll_mapping_versions')
            .select('version')
            .eq('organization_id', context.orgId)
            .eq('id', mapping.current_version_id)
            .single()
            .then(requireRead)
            .then((version) => version.version)
        : Promise.resolve(null),
    ]);
    const employeeNameById = mapEmployeeNames(employees, profiles);
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
      missingAccounts: employees
        .filter((employee) => !openEmployeeIds.has(employee.id))
        .map((employee) => ({
          employeeRecordId: employee.id,
          employeeName: employeeNameById.get(employee.id) ?? 'Unbekannt',
        })),
      employees: employees.map((employee) => ({
        employeeRecordId: employee.id,
        employeeName: employeeNameById.get(employee.id) ?? 'Unbekannt',
        assignedPolicyId: assignedPolicyByEmployee.get(employee.id) ?? null,
      })),
      accounts: accounts.map((account) => ({
        id: account.id,
        employeeRecordId: account.employee_record_id,
        employeeName: employeeNameById.get(account.employee_record_id) ?? 'Unbekannt',
        currentBalanceMinutes: account.current_balance_minutes,
        version: Number(account.version),
      })),
      pendingAdjustments: pending.data.map((request) => ({
        id: request.id,
        employeeName: employeeNameById.get(request.employee_record_id) ?? 'Unbekannt',
        kind: request.adjustment_kind,
        minutes: request.minutes,
        effectiveDate: request.effective_date,
        reason: request.reason,
        version: Number(request.version),
      })),
    };
  });
}
