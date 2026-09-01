"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCachedOrganizationCalendar } from "@/lib/data/cached";
import { authenticateAndAuthorize } from "@/lib/jobs/auth";
import { addLocalDays, resolveBerlinWallTime } from "@/lib/planning/date-time";
import { toEmploymentCondition } from "@/lib/personnel/types";
import { toWorkSchedule } from "@/lib/personnel/schedule";
import { resolveDailyTarget } from "@/lib/personnel/targets";
import { getEffectiveResponsibilityHolderForActor } from "@/lib/responsibilities/server";
import { loadActiveSicknessSpansByRecord } from "@/lib/sickness/server";
import {
  putStorageObject,
  deleteStorageObjects,
  createSignedDownloadUrl,
} from "@/lib/storage/r2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyApprovedTimeCorrections } from "@/lib/time-corrections/projection";
import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionSource,
} from "@/lib/time-corrections/types";
import type { TimeEntry, TimeSegmentKind } from "@/lib/time-tracking/types";
import { loadApprovedVacationSpansByRecord } from "@/lib/vacation/server";
import { calculateEmployeePeriod } from "./calculation";
import {
  DEFAULT_CREDIT_RULES,
  DEFAULT_SUPPLEMENT_RULES,
  DEFAULT_WARNING_RULES,
} from "./defaults";
import { buildPayrollExportPackage, distributeCreditedMinutes } from "./export";
import type {
  DailyTargetInput,
  EmployeePeriodCalculation,
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportValueRow,
  PayrollValueKind,
  TimeAccountPolicy,
  TimeActivityInterval,
  TimeCreditRule,
} from "./types";
import {
  isIsoCalendarDate,
  isValidOptionalIsoDateRange,
} from "./validation";

// P1-23 intentionally fixes the break-warning threshold at six hours.
const BREAK_REQUIRED_ABOVE_MINUTES = 360;

export async function getTimeAccountAccess(): Promise<{
  canManage: boolean;
  isAdmin: boolean;
  canProposeAdjustments: boolean;
}> {
  const context = await requireAuth();
  return {
    canManage: await canManageTimeAccounts(context),
    isAdmin: context.role === "admin",
    canProposeAdjustments:
      context.role === "admin" || context.role === "buero",
  };
}

async function canManageTimeAccounts(context: {
  orgId: string;
  userId: string;
  isManagerOrAbove: boolean;
}): Promise<boolean> {
  if (context.isManagerOrAbove) return true;
  return Boolean(
    await getEffectiveResponsibilityHolderForActor({
      organizationId: context.orgId,
      responsibility: "time_approval",
      actorUserId: context.userId,
    }),
  );
}

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
};

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
    kind: "manual_adjustment" | "expiry" | "payout";
    minutes: number;
    effectiveDate: string;
    reason: string;
    version: number;
  }>;
};

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function monthBounds(month: string): {
  start: string;
  end: string;
  endExclusive: string;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid_month");
  const start = `${month}-01`;
  const nextMonth = new Date(`${start}T12:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const endExclusive = nextMonth.toISOString().slice(0, 10);
  return { start, end: addLocalDays(endExclusive, -1), endExclusive };
}

function parseStrictInteger(value: FormDataEntryValue | null): number | null {
  const text = typeof value === "string" ? value : "";
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addLocalDays(date, 1))
    dates.push(date);
  return dates;
}

function getBerlinInstant(localDateTime: string): string {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error("invalid_berlin_time");
  return resolved.instant.toISOString();
}

function getBerlinDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date(instant));
}

function toLegacyEntries(rows: Array<Record<string, unknown>>): TimeEntry[] {
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: String(row.organization_id),
    entryType: String(row.entry_type) as TimeEntry["entryType"],
    timestamp: String(row.timestamp),
    isManual: Boolean(row.is_manual),
    status: String(row.status) as TimeEntry["status"],
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    originalTimestamp: row.original_timestamp
      ? String(row.original_timestamp)
      : null,
    jobId: row.job_id ? String(row.job_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
  }));
}

function buildLegacyIntervals(
  entries: TimeEntry[],
  employeeRecordId: string,
): TimeActivityInterval[] {
  const intervals: TimeActivityInterval[] = [];
  let active: {
    id: string;
    timestamp: string;
    kind: TimeSegmentKind;
    jobId: string | null;
    projectId: string | null;
  } | null = null;
  for (const entry of [...entries].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    if (entry.status !== "approved") continue;
    const nextKind =
      entry.entryType === "break_start"
        ? "break"
        : (entry.activityKind ?? "work");
    if (
      entry.entryType === "clock_in" ||
      entry.entryType === "break_start" ||
      entry.entryType === "break_end"
    ) {
      if (active && entry.timestamp > active.timestamp) {
        intervals.push({
          sourceId: active.id,
          startedAt: active.timestamp,
          endedAt: entry.timestamp,
          activityKind: active.kind,
          allocationKind: active.jobId ? "job" : "unallocated",
          jobId: active.jobId ?? undefined,
          projectId: active.projectId ?? undefined,
        });
      }
      active = {
        id: entry.id,
        timestamp: entry.timestamp,
        kind: nextKind,
        jobId: entry.jobId,
        projectId: null,
      };
    } else if (entry.entryType === "clock_out") {
      if (active && entry.timestamp > active.timestamp) {
        intervals.push({
          sourceId: active.id,
          startedAt: active.timestamp,
          endedAt: entry.timestamp,
          activityKind: active.kind,
          allocationKind: active.jobId ? "job" : "unallocated",
          jobId: active.jobId ?? undefined,
          projectId: active.projectId ?? undefined,
        });
      }
      active = null;
    }
  }
  return intervals.map((interval) => ({
    ...interval,
    sourceId: interval.sourceId.startsWith("correction:")
      ? interval.sourceId
      : `legacy:${employeeRecordId}:${interval.sourceId}`,
  }));
}

function hasUnclosedLegacySequence(entries: readonly TimeEntry[]): boolean {
  let active = false;
  for (const entry of [...entries].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    if (entry.status !== "approved") continue;
    if (["clock_in", "break_start", "break_end"].includes(entry.entryType))
      active = true;
    if (entry.entryType === "clock_out") active = false;
  }
  return active;
}

async function requireAuth(): Promise<
  Extract<
    Awaited<ReturnType<typeof authenticateAndAuthorize>>,
    { success: true }
  >["context"]
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) redirect("/login");
  return auth.context;
}

export async function getTimeAccountOverview(): Promise<TimeAccountOverview> {
  const context = await requireAuth();
  const admin = createSupabaseAdminClient();
  const { data: employee } = await admin
    .from("employee_records")
    .select("id")
    .eq("organization_id", context.orgId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (!employee) return { account: null, events: [], periods: [] };
  const [{ data: account }, { data: periods }] = await Promise.all([
    admin
      .from("time_accounts")
      .select("id, opened_on, current_balance_minutes")
      .eq("organization_id", context.orgId)
      .eq("employee_record_id", employee.id)
      .maybeSingle(),
    admin
      .from("time_periods")
      .select(
        "id, period_start_date, period_end_date, state, current_calculation_id",
      )
      .eq("organization_id", context.orgId)
      .not("current_calculation_id", "is", null)
      .order("period_start_date", { ascending: false })
      .limit(24),
  ]);
  const currentCalculationIds = (periods ?? []).flatMap((period) =>
    period.current_calculation_id ? [period.current_calculation_id] : [],
  );
  const { data: results } =
    currentCalculationIds.length > 0
      ? await admin
          .from("time_period_employee_results")
          .select(
            "target_minutes, credited_minutes, period_delta_minutes, closing_balance_minutes, calculation_id",
          )
          .eq("organization_id", context.orgId)
          .eq("employee_record_id", employee.id)
          .in("calculation_id", currentCalculationIds)
      : { data: [] };
  const periodByCalculation = new Map(
    (periods ?? []).flatMap((period) =>
      period.current_calculation_id
        ? [[period.current_calculation_id, period] as const]
        : [],
    ),
  );
  const { data: events } = account
    ? await admin
        .from("time_account_events")
        .select("id, event_kind, effective_date, minutes, reason")
        .eq("account_id", account.id)
        .order("effective_date", { ascending: false })
        .limit(50)
    : { data: [] };
  return {
    account: account
      ? {
          id: account.id,
          currentBalanceMinutes: account.current_balance_minutes,
          openedOn: account.opened_on,
        }
      : null,
    events: (events ?? []).map((event) => ({
      id: event.id,
      kind: event.event_kind,
      effectiveDate: event.effective_date,
      minutes: event.minutes,
      reason: event.reason,
    })),
    periods: (results ?? []).flatMap((result) => {
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
}

export async function getTimePeriods(): Promise<TimePeriodListItem[]> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) return [];
  const admin = createSupabaseAdminClient();
  const { data: periods, error } = await admin
    .from("time_periods")
    .select(
      "id, period_start_date, period_end_date, state, current_calculation_id, current_close_version_id",
    )
    .eq("organization_id", context.orgId)
    .order("period_start_date", { ascending: false });
  if (error) throw error;
  const calculationIds = (periods ?? []).flatMap((period) =>
    period.current_calculation_id ? [period.current_calculation_id] : [],
  );
  const closeIds = (periods ?? []).flatMap((period) =>
    period.current_close_version_id ? [period.current_close_version_id] : [],
  );
  const [calculations, results, findings, closes] = await Promise.all([
    calculationIds.length
      ? admin
          .from("time_period_calculations")
          .select("id, version")
          .in("id", calculationIds)
      : Promise.resolve({ data: [] }),
    calculationIds.length
      ? admin
          .from("time_period_employee_results")
          .select("calculation_id")
          .in("calculation_id", calculationIds)
      : Promise.resolve({ data: [] }),
    calculationIds.length
      ? admin
          .from("time_period_findings")
          .select("calculation_id, severity")
          .in("calculation_id", calculationIds)
      : Promise.resolve({ data: [] }),
    closeIds.length
      ? admin
          .from("time_period_close_versions")
          .select("id, version")
          .in("id", closeIds)
      : Promise.resolve({ data: [] }),
  ]);
  const calculationVersionById = new Map(
    (calculations.data ?? []).map((item) => [item.id, item.version]),
  );
  const closeVersionById = new Map(
    (closes.data ?? []).map((item) => [item.id, item.version]),
  );
  const employeeCountByCalculationId = new Map<string, number>();
  for (const result of results.data ?? [])
    employeeCountByCalculationId.set(
      result.calculation_id,
      (employeeCountByCalculationId.get(result.calculation_id) ?? 0) + 1,
    );
  const findingsByCalculationId = new Map<string, typeof findings.data>();
  for (const finding of findings.data ?? []) {
    const list = findingsByCalculationId.get(finding.calculation_id) ?? [];
    list.push(finding);
    findingsByCalculationId.set(finding.calculation_id, list);
  }
  return (periods ?? []).map((period) => {
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
      blockingCount: periodFindings.filter(
        (finding) => finding.severity === "close_blocked",
      ).length,
      closeVersion: period.current_close_version_id
        ? (closeVersionById.get(period.current_close_version_id) ?? null)
        : null,
    };
  });
}

export async function getTimePeriodDetail(
  periodId: string,
): Promise<TimePeriodDetail | null> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) return null;
  const admin = createSupabaseAdminClient();
  const { data: period } = await admin
    .from("time_periods")
    .select(
      "id, period_start_date, period_end_date, state, current_calculation_id",
    )
    .eq("organization_id", context.orgId)
    .eq("id", periodId)
    .maybeSingle();
  if (!period) return null;
  const { data: calculation } = period.current_calculation_id
    ? await admin
        .from("time_period_calculations")
        .select("id, version, source_fingerprint")
        .eq("id", period.current_calculation_id)
        .single()
    : { data: null };
  const [{ data: results }, { data: findings }, { data: exports }] =
    await Promise.all([
      calculation
        ? admin
            .from("time_period_employee_results")
            .select("*")
            .eq("calculation_id", calculation.id)
        : Promise.resolve({ data: [] }),
      calculation
        ? admin
            .from("time_period_findings")
            .select("*")
            .eq("calculation_id", calculation.id)
        : Promise.resolve({ data: [] }),
      admin
        .from("payroll_exports")
        .select("id, version, state, document_id, created_at")
        .eq("period_id", periodId)
        .order("version", { ascending: false }),
    ]);
  const employeeIds = [
    ...new Set([
      ...(results ?? []).map((result) => result.employee_record_id),
      ...(findings ?? []).flatMap((finding) =>
        finding.employee_record_id ? [finding.employee_record_id] : [],
      ),
    ]),
  ];
  const { data: employees } =
    employeeIds.length > 0
      ? await admin
          .from("employee_records")
          .select("id, user_id, first_name, last_name")
          .in("id", employeeIds)
      : { data: [] };
  const userIds = (employees ?? []).flatMap((employee) =>
    employee.user_id ? [employee.user_id] : [],
  );
  const { data: profiles } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", userIds)
      : { data: [] };
  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const nameByEmployee = new Map(
    (employees ?? []).map((employee) => {
      const profile = employee.user_id
        ? profileById.get(employee.user_id)
        : null;
      const name =
        [
          profile?.first_name ?? employee.first_name,
          profile?.last_name ?? employee.last_name,
        ]
          .filter(Boolean)
          .join(" ") || "Unbekannt";
      return [employee.id, name];
    }),
  );
  const findingIds = (findings ?? []).map((finding) => finding.id);
  const { data: decisions } =
    findingIds.length > 0
      ? await admin
          .from("time_period_finding_decisions")
          .select("finding_id, decision, decided_at")
          .in("finding_id", findingIds)
          .order("decided_at", { ascending: false })
      : { data: [] };
  const decisionByFinding = new Map<string, string>();
  for (const decision of decisions ?? [])
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
    results: (results ?? []).map((result) => ({
      employeeRecordId: result.employee_record_id,
      employeeName:
        nameByEmployee.get(result.employee_record_id) ?? "Unbekannt",
      targetMinutes: result.target_minutes,
      creditedMinutes: result.credited_minutes,
      periodDeltaMinutes: result.period_delta_minutes,
      closingBalanceMinutes: result.closing_balance_minutes,
      authoritativeTargets: result.authoritative_targets,
    })),
    findings: (findings ?? []).map((finding) => ({
      id: finding.id,
      employeeRecordId: finding.employee_record_id,
      employeeName: finding.employee_record_id
        ? (nameByEmployee.get(finding.employee_record_id) ?? "Unbekannt")
        : null,
      kind: finding.finding_kind,
      severity: finding.severity,
      explanation: finding.explanation as Record<string, unknown>,
      decision: decisionByFinding.get(finding.id) ?? null,
    })),
    exports: (exports ?? []).map((item) => ({
      id: item.id,
      version: item.version,
      state: item.state,
      documentId: item.document_id,
      createdAt: item.created_at,
    })),
  };
}

export async function getTimeAccountSettings(): Promise<TimeAccountSettingsData> {
  const context = await requireAuth();
  if (context.role !== "admin" && context.role !== "buero")
    return {
      policies: [],
      employeeCount: 0,
      openAccountCount: 0,
      mappingVersion: null,
      missingAccounts: [],
      employees: [],
      accounts: [],
      pendingAdjustments: [],
    };
  const admin = createSupabaseAdminClient();
  const [
    { data: policies },
    { data: employees },
    { data: accounts },
    { data: mapping },
    { data: assignments },
    { data: pendingAdjustments },
  ] = await Promise.all([
    admin
      .from("time_account_policies")
      .select("id, name, is_default, version")
      .eq("organization_id", context.orgId)
      .order("created_at"),
    admin
      .from("employee_records")
      .select("id, user_id, first_name, last_name")
      .eq("organization_id", context.orgId),
    admin
      .from("time_accounts")
      .select("id, employee_record_id, current_balance_minutes, version")
      .eq("organization_id", context.orgId),
    admin
      .from("payroll_mapping_profiles")
      .select("current_version_id")
      .eq("organization_id", context.orgId)
      .maybeSingle(),
    admin
      .from("time_account_policy_assignments")
      .select("employee_record_id, policy_id, valid_from, valid_until")
      .eq("organization_id", context.orgId)
      .lte("valid_from", todayBerlin())
      .or(`valid_until.is.null,valid_until.gte.${todayBerlin()}`)
      .order("valid_from", { ascending: false }),
    admin
      .from("time_account_adjustment_requests")
      .select(
        "id, employee_record_id, adjustment_kind, minutes, effective_date, reason, version",
      )
      .eq("organization_id", context.orgId)
      .eq("status", "submitted")
      .order("created_at"),
  ]);
  const policyIds = (policies ?? []).map((policy) => policy.id);
  const userIds = (employees ?? []).flatMap((employee) =>
    employee.user_id ? [employee.user_id] : [],
  );
  const { data: profiles } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", userIds)
      : { data: [] };
  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const openEmployeeIds = new Set(
    (accounts ?? []).map((account) => account.employee_record_id),
  );
  const employeeNameById = new Map(
    (employees ?? []).map((employee) => {
      const profile = employee.user_id
        ? profileById.get(employee.user_id)
        : null;
      return [
        employee.id,
        [
          profile?.first_name ?? employee.first_name,
          profile?.last_name ?? employee.last_name,
        ]
          .filter(Boolean)
          .join(" ") || "Unbekannt",
      ];
    }),
  );
  const assignedPolicyByEmployee = new Map<string, string>();
  for (const assignment of assignments ?? [])
    if (!assignedPolicyByEmployee.has(assignment.employee_record_id))
      assignedPolicyByEmployee.set(
        assignment.employee_record_id,
        assignment.policy_id,
      );
  const { data: versions } =
    policyIds.length > 0
      ? await admin
          .from("time_account_policy_versions")
          .select("policy_id, effective_from, version")
          .in("policy_id", policyIds)
          .order("version", { ascending: false })
      : { data: [] };
  const latestByPolicy = new Map<
    string,
    { effective_from: string; version: number }
  >();
  for (const version of versions ?? [])
    if (!latestByPolicy.has(version.policy_id))
      latestByPolicy.set(version.policy_id, version);
  let mappingVersion: number | null = null;
  if (mapping?.current_version_id) {
    const { data: version } = await admin
      .from("payroll_mapping_versions")
      .select("version")
      .eq("id", mapping.current_version_id)
      .single();
    mappingVersion = version?.version ?? null;
  }
  return {
    policies: (policies ?? []).map((policy) => ({
      id: policy.id,
      name: policy.name,
      isDefault: policy.is_default,
      version: latestByPolicy.get(policy.id)?.version ?? policy.version,
      effectiveFrom: latestByPolicy.get(policy.id)?.effective_from ?? null,
    })),
    employeeCount: employees?.length ?? 0,
    openAccountCount: accounts?.length ?? 0,
    mappingVersion,
    missingAccounts: (employees ?? [])
      .filter((employee) => !openEmployeeIds.has(employee.id))
      .map((employee) => ({
        employeeRecordId: employee.id,
        employeeName: employeeNameById.get(employee.id) ?? "Unbekannt",
      })),
    employees: (employees ?? []).map((employee) => ({
      employeeRecordId: employee.id,
      employeeName: employeeNameById.get(employee.id) ?? "Unbekannt",
      assignedPolicyId: assignedPolicyByEmployee.get(employee.id) ?? null,
    })),
    accounts: (accounts ?? []).map((account) => ({
      id: account.id,
      employeeRecordId: account.employee_record_id,
      employeeName:
        employeeNameById.get(account.employee_record_id) ?? "Unbekannt",
      currentBalanceMinutes: account.current_balance_minutes,
      version: Number(account.version),
    })),
    pendingAdjustments: (pendingAdjustments ?? []).map((request) => ({
      id: request.id,
      employeeName:
        employeeNameById.get(request.employee_record_id) ?? "Unbekannt",
      kind: request.adjustment_kind,
      minutes: request.minutes,
      effectiveDate: request.effective_date,
      reason: request.reason,
      version: Number(request.version),
    })),
  };
}

function todayBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date());
}

export async function createStarterTimePolicy(
  formData: FormData,
): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin") throw new Error("forbidden");
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "");
  const name = String(formData.get("name") ?? "Standard-Arbeitszeit");
  const createAsException = formData.get("policyKind") === "exception";
  const operationId = randomUUID();
  if (!name.trim() || !isIsoCalendarDate(effectiveFrom))
    throw new Error("invalid_policy_version");
  const payload = {
    effectiveFrom,
    name,
    createAsException,
    credit: DEFAULT_CREDIT_RULES,
    supplements: DEFAULT_SUPPLEMENT_RULES,
    warnings: DEFAULT_WARNING_RULES,
  };
  const admin = createSupabaseAdminClient();
  const { data: currentPolicy } = await admin
    .from("time_account_policies")
    .select("id")
    .eq("organization_id", context.orgId)
    .eq("is_default", true)
    .is("retired_at", null)
    .maybeSingle();
  const { error } = await admin.rpc("create_time_account_policy_version", {
    p_organization_id: context.orgId,
    p_policy_id: createAsException ? null : (currentPolicy?.id ?? null),
    p_name: name,
    p_is_default: !createAsException,
    p_effective_from: effectiveFrom,
    p_vacation_treatment: "paid",
    p_sickness_treatment: "paid",
    p_night_window_start: null,
    p_night_window_end: null,
    p_credit_rules: DEFAULT_CREDIT_RULES,
    p_supplement_rules: DEFAULT_SUPPLEMENT_RULES,
    p_warning_rules: DEFAULT_WARNING_RULES,
    p_actor_id: context.userId,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
}

export async function assignEmployeeTimePolicy(
  formData: FormData,
): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin") throw new Error("forbidden");
  const employeeRecordId = String(formData.get("employeeRecordId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  const validFrom = String(formData.get("validFrom") ?? "");
  const validUntilValue = String(formData.get("validUntil") ?? "");
  const reason = String(
    formData.get("reason") ?? "Individuelle Arbeitszeitregel",
  );
  if (
    !employeeRecordId ||
    !policyId ||
    !isValidOptionalIsoDateRange(validFrom, validUntilValue) ||
    !reason.trim()
  )
    throw new Error("invalid_policy_assignment");
  const operationId = randomUUID();
  const payload = {
    employeeRecordId,
    policyId,
    validFrom,
    validUntil: validUntilValue || null,
    reason,
  };
  const { error } = await createSupabaseAdminClient().rpc(
    "assign_time_account_policy",
    {
      p_organization_id: context.orgId,
      p_employee_record_id: employeeRecordId,
      p_policy_id: policyId,
      p_valid_from: validFrom,
      p_valid_until: validUntilValue || null,
      p_reason: reason,
      p_actor_id: context.userId,
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
}

export async function openMissingTimeAccounts(
  formData: FormData,
): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin") throw new Error("forbidden");
  const employeeRecordId = String(formData.get("employeeRecordId") ?? "");
  const openingMinutes = parseStrictInteger(formData.get("openingMinutes"));
  const openedOn = String(formData.get("openedOn") ?? "");
  const reason = String(formData.get("reason") ?? "Einführung des Zeitkontos");
  if (
    !employeeRecordId ||
    openingMinutes === null ||
    !isIsoCalendarDate(openedOn) ||
    !reason.trim()
  )
    throw new Error("invalid_opening_balance");
  const admin = createSupabaseAdminClient();
  const operationId = randomUUID();
  const payload = { employeeRecordId, openedOn, openingMinutes, reason };
  const { error } = await admin.rpc("open_time_account", {
    p_organization_id: context.orgId,
    p_employee_record_id: employeeRecordId,
    p_opening_minutes: openingMinutes,
    p_opened_on: openedOn,
    p_reason: reason,
    p_actor_id: context.userId,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
  revalidatePath("/zeiterfassung/zeitkonto");
}

export async function submitTimeAccountAdjustment(
  formData: FormData,
): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin" && context.role !== "buero")
    throw new Error("forbidden");
  const accountId = String(formData.get("accountId") ?? "");
  const expectedVersion = parseStrictInteger(formData.get("expectedVersion"));
  const adjustmentKind = String(formData.get("adjustmentKind") ?? "");
  const minutes = parseStrictInteger(formData.get("minutes"));
  const effectiveDate = String(formData.get("effectiveDate") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (
    !accountId ||
    expectedVersion === null ||
    minutes === null ||
    minutes === 0 ||
    !["manual_adjustment", "expiry", "payout"].includes(adjustmentKind) ||
    !isIsoCalendarDate(effectiveDate) ||
    !reason.trim()
  )
    throw new Error("invalid_adjustment");
  const operationId = randomUUID();
  const payload = {
    accountId,
    expectedVersion,
    adjustmentKind,
    minutes,
    effectiveDate,
    reason,
  };
  const { error } = await createSupabaseAdminClient().rpc(
    "submit_time_account_adjustment",
    {
      p_organization_id: context.orgId,
      p_account_id: accountId,
      p_expected_account_version: expectedVersion,
      p_adjustment_kind: adjustmentKind as
        | "manual_adjustment"
        | "expiry"
        | "payout",
      p_minutes: minutes,
      p_effective_date: effectiveDate,
      p_reason: reason,
      p_actor_id: context.userId,
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
  revalidatePath("/zeiterfassung/zeitkonto");
}

export async function decideTimeAccountAdjustment(
  formData: FormData,
): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const requestId = String(formData.get("requestId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (
    !requestId ||
    !Number.isSafeInteger(expectedVersion) ||
    !["approved", "rejected"].includes(decision) ||
    !reason.trim()
  )
    throw new Error("invalid_adjustment_decision");
  const { error } = await createSupabaseAdminClient().rpc(
    "decide_time_account_adjustment",
    {
      p_organization_id: context.orgId,
      p_request_id: requestId,
      p_expected_version: expectedVersion,
      p_decision: decision as "approved" | "rejected",
      p_reason: reason,
      p_actor_id: context.userId,
      p_operation_id: randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
  revalidatePath("/zeiterfassung/zeitkonto");
}

async function resolvePoliciesForPeriod(
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, Map<string, TimeAccountPolicy | null>>> {
  const admin = createSupabaseAdminClient();
  const [{ data: assignments }, { data: policies }] = await Promise.all([
    employeeRecordIds.length
      ? admin
          .from("time_account_policy_assignments")
          .select("employee_record_id, policy_id, valid_from, valid_until")
          .eq("organization_id", organizationId)
          .in("employee_record_id", [...employeeRecordIds])
          .lte("valid_from", periodEnd)
          .or(`valid_until.is.null,valid_until.gte.${periodStart}`)
          .order("valid_from", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin
      .from("time_account_policies")
      .select("id, is_default, retired_at")
      .eq("organization_id", organizationId),
  ]);
  const defaultPolicyId = (policies ?? []).find(
    (policy) => policy.is_default && !policy.retired_at,
  )?.id;
  const policyIds = [
    ...new Set([
      ...(assignments ?? []).map((assignment) => assignment.policy_id),
      ...(defaultPolicyId ? [defaultPolicyId] : []),
    ]),
  ];
  if (policyIds.length === 0)
    return new Map(
      employeeRecordIds.map((id) => [
        id,
        new Map(
          getDateRange(periodStart, periodEnd).map((date) => [date, null]),
        ),
      ]),
    );
  const { data: versions } = await admin
    .from("time_account_policy_versions")
    .select("*")
    .in("policy_id", policyIds)
    .lte("effective_from", periodEnd)
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false });
  const versionIds = (versions ?? []).map((version) => version.id);
  if (versionIds.length === 0)
    return new Map(
      employeeRecordIds.map((id) => [
        id,
        new Map(
          getDateRange(periodStart, periodEnd).map((date) => [date, null]),
        ),
      ]),
    );
  const [{ data: credits }, { data: supplements }, { data: warnings }] =
    await Promise.all([
      admin
        .from("time_account_policy_credit_rules")
        .select("*")
        .in("policy_version_id", versionIds),
      admin
        .from("time_account_policy_supplement_rules")
        .select("*")
        .in("policy_version_id", versionIds),
      admin
        .from("time_account_policy_warning_rules")
        .select("*")
        .in("policy_version_id", versionIds),
    ]);
  const policyByVersionId = new Map<string, TimeAccountPolicy>();
  for (const version of versions ?? []) {
    const versionCredits = (credits ?? []).filter(
      (rule) => rule.policy_version_id === version.id,
    );
    const versionSupplements = (supplements ?? []).filter(
      (rule) => rule.policy_version_id === version.id,
    );
    const versionWarnings = (warnings ?? []).filter(
      (warning) => warning.policy_version_id === version.id,
    );
    const creditRules: TimeCreditRule[] = versionCredits.map((rule) => {
      if (rule.activity_kind === "travel")
        return {
          activityKind: "travel",
          travelRoute: rule.travel_route!,
          travelRole: rule.travel_role!,
          percentage: rule.credit_percentage as 0 | 50 | 100,
        };
      if (rule.activity_kind === "standby")
        return {
          activityKind: "standby",
          standbyContext: rule.standby_context!,
          percentage: rule.credit_percentage as 0 | 50 | 100,
        };
      return {
        activityKind: rule.activity_kind as Exclude<
          TimeSegmentKind,
          "travel" | "standby"
        >,
        percentage: rule.credit_percentage as 0 | 50 | 100,
      };
    });
    policyByVersionId.set(version.id, {
      id: version.id,
      version: version.version,
      effectiveFrom: version.effective_from,
      creditRules,
      supplementRules: (["night", "sunday", "public_holiday"] as const).map(
        (kind) => ({
          supplementKind: kind,
          enabled: versionSupplements.some(
            (rule) => rule.supplement_kind === kind && rule.enabled,
          ),
          eligibleActivityKinds: versionSupplements
            .filter((rule) => rule.supplement_kind === kind && rule.enabled)
            .map((rule) => rule.activity_kind),
        }),
      ),
      nightWindow:
        version.night_window_start && version.night_window_end
          ? {
              start: version.night_window_start.slice(0, 5),
              end: version.night_window_end.slice(0, 5),
            }
          : null,
      vacationTreatment: version.vacation_treatment,
      sicknessTreatment: version.sickness_treatment,
      warningRules: versionWarnings.map((warning) => ({
        warningKind: warning.warning_kind,
        enabled: warning.enabled,
        severity: warning.severity,
        thresholdMinutes: warning.threshold_minutes,
      })),
    });
  }
  const dates = getDateRange(periodStart, periodEnd);
  const result = new Map<string, Map<string, TimeAccountPolicy | null>>();
  for (const employeeRecordId of employeeRecordIds) {
    const employeeAssignments = (assignments ?? []).filter(
      (assignment) => assignment.employee_record_id === employeeRecordId,
    );
    const byDate = new Map<string, TimeAccountPolicy | null>();
    for (const date of dates) {
      const assignment = employeeAssignments.find(
        (candidate) =>
          candidate.valid_from <= date &&
          (candidate.valid_until === null || candidate.valid_until >= date),
      );
      const policyId = assignment?.policy_id ?? defaultPolicyId;
      const version = (versions ?? []).find(
        (candidate) =>
          candidate.policy_id === policyId && candidate.effective_from <= date,
      );
      byDate.set(
        date,
        version ? (policyByVersionId.get(version.id) ?? null) : null,
      );
    }
    result.set(employeeRecordId, byDate);
  }
  return result;
}

export async function prepareTimePeriod(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const month = String(formData.get("month") ?? "");
  const bounds = monthBounds(month);
  const startInstant = getBerlinInstant(`${bounds.start}T00:00`);
  const endInstant = getBerlinInstant(`${bounds.endExclusive}T00:00`);
  const admin = createSupabaseAdminClient();
  const [
    { data: employees },
    { data: accounts },
    { data: accountEvents },
    { data: segments },
    { data: sessions },
    { data: legacyRows },
    { data: schedules },
    { data: conditions },
    { data: jobs },
    { data: projects },
    { data: correctionApplications },
    { data: correctionSources },
    { data: correctionRequests },
    { data: correctionRevisions },
    calendar,
    vacations,
    sickness,
  ] = await Promise.all([
    admin
      .from("employee_records")
      .select("*")
      .eq("organization_id", context.orgId),
    admin
      .from("time_accounts")
      .select("*")
      .eq("organization_id", context.orgId),
    admin
      .from("time_account_events")
      .select("*")
      .eq("organization_id", context.orgId)
      .lte("effective_date", bounds.end),
    admin
      .from("time_segments")
      .select("*")
      .eq("organization_id", context.orgId)
      .lt("started_at", endInstant)
      .not("ended_at", "is", null)
      .gt("ended_at", startInstant),
    admin
      .from("time_sessions")
      .select("id, employee_record_id, status, started_at")
      .eq("organization_id", context.orgId)
      .in("status", ["open", "recovery_required"])
      .lt("started_at", endInstant),
    admin
      .from("time_entries")
      .select("*")
      .eq("organization_id", context.orgId)
      .is("operation_id", null)
      .gte(
        "timestamp",
        getBerlinInstant(`${addLocalDays(bounds.start, -1)}T00:00`),
      )
      .lt("timestamp", endInstant),
    admin
      .from("work_schedules")
      .select("*")
      .eq("organization_id", context.orgId)
      .lte("valid_from", bounds.end),
    admin
      .from("employment_conditions")
      .select("*")
      .eq("organization_id", context.orgId)
      .lte("valid_from", bounds.end),
    admin
      .from("jobs")
      .select("id, job_number, project_id")
      .eq("organization_id", context.orgId),
    admin
      .from("projects")
      .select("id, project_number")
      .eq("organization_id", context.orgId),
    admin
      .from("time_correction_applications")
      .select("*")
      .eq("organization_id", context.orgId),
    admin
      .from("time_correction_request_sources")
      .select("*")
      .eq("organization_id", context.orgId),
    admin
      .from("time_correction_requests")
      .select("id, subject_employee_record_id, current_revision, status")
      .eq("organization_id", context.orgId),
    admin
      .from("time_correction_request_revisions")
      .select("request_id, revision, proposed_snapshot")
      .eq("organization_id", context.orgId),
    getCachedOrganizationCalendar(context.orgId),
    loadApprovedVacationSpansByRecord(context.orgId, bounds.start, bounds.end),
    loadActiveSicknessSpansByRecord(context.orgId, bounds.start, bounds.end),
  ]);
  const accountByEmployee = new Map(
    (accounts ?? []).map((account) => [account.employee_record_id, account]),
  );
  const eventsByEmployee = new Map<string, typeof accountEvents>();
  for (const event of accountEvents ?? []) {
    const list = eventsByEmployee.get(event.employee_record_id) ?? [];
    list.push(event);
    eventsByEmployee.set(event.employee_record_id, list);
  }
  const legacyByUser = new Map<string, TimeEntry[]>();
  const correctionSourcesByRevision = new Map<string, TimeCorrectionSource[]>();
  for (const source of correctionSources ?? []) {
    const sourceId =
      source.time_entry_id ??
      source.time_session_id ??
      source.time_segment_id ??
      source.correction_application_id;
    if (!sourceId) continue;
    const key = `${source.request_id}:${source.revision}`;
    const list = correctionSourcesByRevision.get(key) ?? [];
    list.push({
      kind: source.source_kind,
      id: sourceId,
      version: source.source_version,
    });
    correctionSourcesByRevision.set(key, list);
  }
  const approvedCorrectionApplications: TimeCorrectionApplicationProjection[] =
    (correctionApplications ?? []).flatMap((application) => {
      if (!isTimeCorrectionSnapshot(application.applied_snapshot)) return [];
      return [
        {
          applicationId: application.id,
          requestId: application.request_id,
          appliedAt: application.applied_at,
          appliedBy: application.applied_by,
          sourceFingerprint: application.source_fingerprint,
          snapshot: application.applied_snapshot,
          sources:
            correctionSourcesByRevision.get(
              `${application.request_id}:${application.revision}`,
            ) ?? [],
        },
      ];
    });
  const suppressedSegmentIds = new Set(
    approvedCorrectionApplications.flatMap((application) =>
      application.sources.flatMap((source) =>
        source.kind === "canonical_segment" ? [source.id] : [],
      ),
    ),
  );
  const effectiveEntries = applyApprovedTimeCorrections(
    toLegacyEntries((legacyRows ?? []) as Array<Record<string, unknown>>),
    approvedCorrectionApplications,
    context.orgId,
  );
  legacyByUser.clear();
  for (const entry of effectiveEntries) {
    const list = legacyByUser.get(entry.userId) ?? [];
    list.push(entry);
    legacyByUser.set(entry.userId, list);
  }
  const periodEmployees = (employees ?? []).filter(
    (employee) =>
      (employee.entry_date === null || employee.entry_date <= bounds.end) &&
      (employee.exit_date === null || employee.exit_date >= bounds.start),
  );
  const projectNumberById = new Map(
    (projects ?? []).map((project) => [project.id, project.project_number]),
  );
  const jobById = new Map((jobs ?? []).map((job) => [job.id, job]));
  const dates = getDateRange(bounds.start, bounds.end);
  const dateBounds = new Map(
    dates.map((date) => [
      date,
      {
        start: new Date(getBerlinInstant(`${date}T00:00`)).getTime(),
        end: new Date(
          getBerlinInstant(`${addLocalDays(date, 1)}T00:00`),
        ).getTime(),
      },
    ]),
  );
  const policiesByEmployee = await resolvePoliciesForPeriod(
    context.orgId,
    bounds.start,
    bounds.end,
    periodEmployees.map((employee) => employee.id),
  );
  const employeePayload: Array<Record<string, unknown>> = [];
  const dailyPayload: Array<Record<string, unknown>> = [];
  const sourcePayload: Array<Record<string, unknown>> = [];
  const findingPayload: Array<Record<string, unknown>> = [];

  for (const employee of periodEmployees) {
    const policiesByDate =
      policiesByEmployee.get(employee.id) ??
      new Map(dates.map((date) => [date, null]));
    const policy = policiesByDate.get(bounds.end) ?? null;
    const hasCompletePolicyHistory = dates.every(
      (date) => policiesByDate.get(date) !== null,
    );
    const employeeResultId = randomUUID();
    const accountCandidate = accountByEmployee.get(employee.id);
    const account =
      accountCandidate && accountCandidate.opened_on <= bounds.end
        ? accountCandidate
        : undefined;
    const employeeSegments = (segments ?? []).filter(
      (segment) =>
        segment.employee_record_id === employee.id &&
        !suppressedSegmentIds.has(segment.id),
    );
    const intervals: TimeActivityInterval[] = employeeSegments.map(
      (segment) => {
        const job = segment.job_id ? jobById.get(segment.job_id) : undefined;
        const projectId = job?.project_id ?? undefined;
        return {
          sourceId: `segment:${segment.id}`,
          startedAt: segment.started_at,
          endedAt: segment.ended_at!,
          activityKind: segment.kind,
          travelRoute: segment.travel_route ?? undefined,
          travelRole: segment.travel_role ?? undefined,
          standbyContext: segment.standby_context ?? undefined,
          allocationKind: segment.allocation_kind,
          jobId: segment.job_id ?? undefined,
          jobNumber: job?.job_number,
          projectId,
          projectNumber: projectId
            ? projectNumberById.get(projectId)
            : undefined,
        };
      },
    );
    if (employee.user_id)
      intervals.push(
        ...buildLegacyIntervals(
          legacyByUser.get(employee.user_id) ?? [],
          employee.id,
        ),
      );
    for (const interval of intervals) {
      if (!interval.jobId || interval.jobNumber) continue;
      const job = jobById.get(interval.jobId);
      const projectId = job?.project_id ?? interval.projectId;
      interval.jobNumber = job?.job_number;
      interval.projectId = projectId;
      interval.projectNumber = projectId
        ? projectNumberById.get(projectId)
        : undefined;
    }
    const employeeSchedules = (schedules ?? [])
      .filter((schedule) => schedule.employee_record_id === employee.id)
      .map(toWorkSchedule);
    const employeeConditions = (conditions ?? [])
      .filter((condition) => condition.employee_record_id === employee.id)
      .map(toEmploymentCondition);
    const absenceSpans = [
      ...(vacations.get(employee.id) ?? []),
      ...(sickness.get(employee.id) ?? []),
    ];
    const resolvedTargets = dates.map((date) =>
      resolveDailyTarget({
        dateIso: date,
        schedules: employeeSchedules,
        conditions: employeeConditions,
        calendar,
        absences: absenceSpans,
      }),
    );
    const dailyTargets: DailyTargetInput[] = resolvedTargets.map((target) => {
      const vacationMinutes =
        target.absence?.type === "vacation"
          ? target.baseTargetMinutes - target.targetMinutes
          : 0;
      const sicknessMinutes =
        target.absence?.type === "sickness"
          ? target.baseTargetMinutes - target.targetMinutes
          : 0;
      const treatment =
        target.absence?.type === "vacation"
          ? policiesByDate.get(target.date)?.vacationTreatment
          : policiesByDate.get(target.date)?.sicknessTreatment;
      const targetMinutes =
        target.absence && treatment === "informational"
          ? target.baseTargetMinutes
          : target.targetMinutes;
      return {
        localDate: target.date,
        targetMinutes,
        source:
          target.source === "schedule"
            ? "schedule"
            : target.source === "derived"
              ? "employment_condition"
              : "default",
        vacationMinutes,
        sicknessMinutes,
      };
    });
    const employeeEvents = eventsByEmployee.get(employee.id) ?? [];
    const previousBalanceMinutes = employeeEvents
      .filter((event) => event.effective_date < bounds.start)
      .reduce((sum, event) => sum + event.minutes, 0);
    const eventInputs = employeeEvents
      .filter(
        (event) =>
          event.effective_date >= bounds.start &&
          ["opening_balance", "manual_adjustment", "expiry", "payout"].includes(
            event.event_kind,
          ),
      )
      .map((event) => ({
        id: event.id,
        kind: event.event_kind as
          | "opening_balance"
          | "manual_adjustment"
          | "expiry"
          | "payout",
        effectiveDate: event.effective_date,
        minutes: event.minutes,
      }));
    let calculation: EmployeePeriodCalculation;
    if (policy && account && hasCompletePolicyHistory) {
      calculation = calculateEmployeePeriod({
        employeeRecordId: employee.id,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        previousBalanceMinutes,
        policy,
        policyByDate: new Map(
          [...policiesByDate].flatMap(([date, datedPolicy]) =>
            datedPolicy ? [[date, datedPolicy] as const] : [],
          ),
        ),
        activityIntervals: intervals,
        dailyTargets,
        accountEvents: eventInputs,
        publicHolidayDates: new Set(
          resolvedTargets
            .filter((target) => target.isHoliday)
            .map((target) => target.date),
        ),
      });
    } else {
      calculation = {
        employeeRecordId: employee.id,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        policyId: policy?.id ?? "",
        policyVersion: policy?.version ?? 0,
        activityBuckets: [],
        supplementBuckets: [],
        targetMinutes: dailyTargets.reduce(
          (sum, target) => sum + target.targetMinutes,
          0,
        ),
        sourceMinutes: 0,
        creditedMinutes: 0,
        vacationMinutes: dailyTargets.reduce(
          (sum, target) => sum + target.vacationMinutes,
          0,
        ),
        sicknessMinutes: dailyTargets.reduce(
          (sum, target) => sum + target.sicknessMinutes,
          0,
        ),
        accountEventMinutes: 0,
        periodDeltaMinutes: 0,
        overtimeCandidateMinutes: 0,
        previousBalanceMinutes,
        closingBalanceMinutes: previousBalanceMinutes,
        hasAuthoritativeTargets: false,
      };
    }
    const targetsByDate = new Map(
      dailyTargets.map((target) => [target.localDate, target]),
    );
    employeePayload.push({
      id: employeeResultId,
      employee_record_id: employee.id,
      policy_version_id: policy?.id ?? null,
      previous_balance_minutes: calculation.previousBalanceMinutes,
      target_minutes: calculation.targetMinutes,
      source_seconds: calculation.activityBuckets.reduce(
        (sum, bucket) => sum + bucket.sourceSeconds,
        0,
      ),
      source_minutes: calculation.sourceMinutes,
      credited_minutes: calculation.creditedMinutes,
      vacation_minutes: calculation.vacationMinutes,
      sickness_minutes: calculation.sicknessMinutes,
      account_event_minutes: calculation.accountEventMinutes,
      period_delta_minutes: calculation.periodDeltaMinutes,
      overtime_candidate_minutes: calculation.overtimeCandidateMinutes,
      closing_balance_minutes: calculation.closingBalanceMinutes,
      authoritative_targets: calculation.hasAuthoritativeTargets,
    });
    if (!policy || !hasCompletePolicyHistory)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "missing_policy",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          employee: employee.id,
          kind: "missing_policy",
          dates: dates.filter((date) => !policiesByDate.get(date)),
        }),
        explanation: {
          dates: dates.filter((date) => !policiesByDate.get(date)),
        },
      });
    if (!account)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "missing_opening_balance",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          employee: employee.id,
          kind: "missing_account",
        }),
        explanation: {},
      });
    if (!calculation.hasAuthoritativeTargets)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "missing_schedule",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          employee: employee.id,
          kind: "missing_schedule",
        }),
        explanation: {},
      });
    const openSession = (sessions ?? []).find(
      (session) => session.employee_record_id === employee.id,
    );
    if (openSession)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind:
          openSession.status === "recovery_required"
            ? "recovery_session"
            : "open_session",
        severity: "close_blocked",
        source_fingerprint: hashPayload(openSession),
        explanation: { startedAt: openSession.started_at },
      });
    const effectiveEmployeeEntries = employee.user_id
      ? (legacyByUser.get(employee.user_id) ?? [])
      : [];
    if (hasUnclosedLegacySequence(effectiveEmployeeEntries))
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "missing_clock",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          employee: employee.id,
          kind: "missing_clock",
          entries: effectiveEmployeeEntries.map((entry) => entry.id),
        }),
        explanation: {},
      });
    const sortedIntervals = [...intervals].sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt),
    );
    const overlap = sortedIntervals.find(
      (interval, index) =>
        index > 0 && interval.startedAt < sortedIntervals[index - 1]!.endedAt,
    );
    if (overlap)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "overlap",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          employee: employee.id,
          kind: "overlap",
          sourceId: overlap.sourceId,
        }),
        explanation: { sourceId: overlap.sourceId },
      });
    const unallocated = intervals.filter(
      (interval) =>
        interval.allocationKind === "unallocated" &&
        !["break", "standby", "internal_activity"].includes(
          interval.activityKind,
        ),
    );
    if (unallocated.length > 0)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "unallocated_time",
        severity: "approval_required",
        source_fingerprint: hashPayload({
          employee: employee.id,
          sources: unallocated.map((interval) => interval.sourceId).sort(),
        }),
        explanation: { count: unallocated.length },
      });
    const pendingRequests = (correctionRequests ?? []).filter(
      (request) =>
        request.subject_employee_record_id === employee.id &&
        ["submitted", "clarification_required"].includes(request.status),
    );
    const pendingRequest = pendingRequests.find((request) => {
      const revision = (correctionRevisions ?? []).find(
        (item) =>
          item.request_id === request.id &&
          item.revision === request.current_revision,
      );
      return (
        revision &&
        isTimeCorrectionSnapshot(revision.proposed_snapshot) &&
        revision.proposed_snapshot.facts.some(
          (fact) =>
            fact.timestamp >= startInstant && fact.timestamp < endInstant,
        )
      );
    });
    if (pendingRequest)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "pending_correction",
        severity: "close_blocked",
        source_fingerprint: hashPayload({
          requestId: pendingRequest.id,
          revision: pendingRequest.current_revision,
        }),
        explanation: { requestId: pendingRequest.id },
      });
    const absenceConflictDates = calculation.activityBuckets
      .filter(
        (bucket) =>
          bucket.creditedMinutes > 0 &&
          (targetsByDate.get(bucket.localDate)?.vacationMinutes ?? 0) +
            (targetsByDate.get(bucket.localDate)?.sicknessMinutes ?? 0) >
            0,
      )
      .map((bucket) => bucket.localDate);
    if (absenceConflictDates.length > 0)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "absence_conflict",
        severity: "approval_required",
        source_fingerprint: hashPayload({
          employee: employee.id,
          dates: [...new Set(absenceConflictDates)].sort(),
        }),
        explanation: { dates: [...new Set(absenceConflictDates)].sort() },
      });
    const dailySourceMinutes = new Map<string, number>();
    const dailyBreakMinutes = new Map<string, number>();
    for (const bucket of calculation.activityBuckets) {
      dailySourceMinutes.set(
        bucket.localDate,
        (dailySourceMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
      );
      if (bucket.activityKind === "break")
        dailyBreakMinutes.set(
          bucket.localDate,
          (dailyBreakMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
        );
    }
    const restMinutesByDate = new Map<string, number>();
    const workedIntervals = sortedIntervals.filter(
      (interval) => interval.activityKind !== "break",
    );
    for (let index = 1; index < workedIntervals.length; index += 1) {
      const previous = workedIntervals[index - 1]!;
      const current = workedIntervals[index]!;
      const previousDate = getBerlinDate(previous.endedAt);
      const currentDate = getBerlinDate(current.startedAt);
      if (previousDate === currentDate) continue;
      const restMinutes = Math.max(
        0,
        Math.floor(
          (new Date(current.startedAt).getTime() -
            new Date(previous.endedAt).getTime()) /
            60_000,
        ),
      );
      restMinutesByDate.set(
        currentDate,
        Math.min(restMinutesByDate.get(currentDate) ?? Infinity, restMinutes),
      );
    }
    const effectivePolicies = [
      ...new Map(
        [...policiesByDate.values()].flatMap((datedPolicy) =>
          datedPolicy ? [[datedPolicy.id, datedPolicy] as const] : [],
        ),
      ).values(),
    ];
    for (const effectivePolicy of effectivePolicies) {
      for (const warning of effectivePolicy.warningRules) {
        if (!warning.enabled) continue;
        const thresholdMinutes = warning.thresholdMinutes ?? 0;
        const candidateDates = [...dailySourceMinutes.keys()].sort();
        const matchingDays = candidateDates.filter((localDate) => {
          if (policiesByDate.get(localDate)?.id !== effectivePolicy.id)
            return false;
          if (warning.warningKind === "night_work")
            return calculation.supplementBuckets.some(
              (item) =>
                item.localDate === localDate &&
                item.supplementKind === "night" &&
                item.minutes > 0,
            );
          if (warning.warningKind === "sunday_work")
            return calculation.supplementBuckets.some(
              (item) =>
                item.localDate === localDate &&
                item.supplementKind === "sunday" &&
                item.minutes > 0,
            );
          if (warning.warningKind === "public_holiday_work")
            return calculation.supplementBuckets.some(
              (item) =>
                item.localDate === localDate &&
                item.supplementKind === "public_holiday" &&
                item.minutes > 0,
            );
          if (warning.warningKind === "daily_duration")
            return (dailySourceMinutes.get(localDate) ?? 0) > thresholdMinutes;
          if (warning.warningKind === "break_duration")
            return (
              (dailySourceMinutes.get(localDate) ?? 0) -
                (dailyBreakMinutes.get(localDate) ?? 0) >
                BREAK_REQUIRED_ABOVE_MINUTES &&
              (dailyBreakMinutes.get(localDate) ?? 0) < thresholdMinutes
            );
          if (warning.warningKind === "rest_duration")
            return (
              (restMinutesByDate.get(localDate) ?? Infinity) < thresholdMinutes
            );
          return false;
        });
        if (matchingDays.length === 0) continue;
        findingPayload.push({
          employee_record_id: employee.id,
          local_date: null,
          finding_kind: warning.warningKind,
          severity: warning.severity,
          source_fingerprint: hashPayload({
            employee: employee.id,
            warning: warning.warningKind,
            dates: [...new Set(matchingDays)].sort(),
          }),
          explanation: { dates: [...new Set(matchingDays)].sort() },
        });
      }
    }
    if (calculation.overtimeCandidateMinutes > 0)
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: "positive_overtime",
        severity: "approval_required",
        source_fingerprint: hashPayload({
          employee: employee.id,
          overtime: calculation.overtimeCandidateMinutes,
        }),
        explanation: { minutes: calculation.overtimeCandidateMinutes },
      });

    const bucketsByDate = new Map<string, typeof calculation.activityBuckets>();
    for (const bucket of calculation.activityBuckets) {
      const list = bucketsByDate.get(bucket.localDate) ?? [];
      bucketsByDate.set(bucket.localDate, [...list, bucket]);
    }
    const supplementsByDate = new Map<
      string,
      typeof calculation.supplementBuckets
    >();
    for (const supplement of calculation.supplementBuckets) {
      const list = supplementsByDate.get(supplement.localDate) ?? [];
      supplementsByDate.set(supplement.localDate, [...list, supplement]);
    }
    const intervalBySourceId = new Map(
      intervals.map((interval) => [interval.sourceId, interval]),
    );
    for (const date of dates) {
      const buckets = bucketsByDate.get(date) ?? [];
      const rows =
        buckets.length > 0
          ? buckets
          : [
              {
                activityKind: "work" as const,
                localDate: date,
                sourceSeconds: 0,
                sourceMinutes: 0,
                creditedSeconds: 0,
                creditedMinutes: 0,
                roundingDeltaSeconds: 0,
                percentage: 100 as const,
                sourceIds: [],
              },
            ];
      const supplements = supplementsByDate.get(date) ?? [];
      rows.forEach((bucket, index) => {
        const dailyId = randomUUID();
        dailyPayload.push({
          id: dailyId,
          employee_result_id: employeeResultId,
          employee_record_id: employee.id,
          local_date: date,
          activity_kind: bucket.activityKind,
          travel_route: bucket.travelRoute ?? null,
          travel_role: bucket.travelRole ?? null,
          standby_context: bucket.standbyContext ?? null,
          credit_percentage: bucket.percentage,
          source_seconds: bucket.sourceSeconds,
          source_minutes: bucket.sourceMinutes,
          credited_seconds: bucket.creditedSeconds,
          credited_minutes: bucket.creditedMinutes,
          rounding_delta_seconds: bucket.roundingDeltaSeconds,
          target_minutes:
            index === 0 ? (targetsByDate.get(date)?.targetMinutes ?? 0) : 0,
          vacation_minutes:
            index === 0 ? (targetsByDate.get(date)?.vacationMinutes ?? 0) : 0,
          sickness_minutes:
            index === 0 ? (targetsByDate.get(date)?.sicknessMinutes ?? 0) : 0,
          night_minutes:
            index === 0
              ? (supplements.find((item) => item.supplementKind === "night")
                  ?.minutes ?? 0)
              : 0,
          sunday_minutes:
            index === 0
              ? (supplements.find((item) => item.supplementKind === "sunday")
                  ?.minutes ?? 0)
              : 0,
          public_holiday_minutes:
            index === 0
              ? (supplements.find(
                  (item) => item.supplementKind === "public_holiday",
                )?.minutes ?? 0)
              : 0,
        });
        for (const sourceId of bucket.sourceIds) {
          const sourceParts = sourceId.split(":");
          const sourceKind = sourceId.startsWith("segment:")
            ? "time_segment"
            : sourceId.startsWith("correction:")
              ? "correction_application"
              : "legacy_entry";
          const sourceRecordId =
            sourceKind === "correction_application"
              ? sourceParts[1]
              : sourceParts.at(-1);
          const interval = intervalBySourceId.get(sourceId);
          const dayStart = dateBounds.get(date)!.start;
          const dayEnd = dateBounds.get(date)!.end;
          const overlapSeconds = interval
            ? Math.max(
                0,
                Math.min(new Date(interval.endedAt).getTime(), dayEnd) -
                  Math.max(new Date(interval.startedAt).getTime(), dayStart),
              ) / 1000
            : 0;
          sourcePayload.push({
            employee_result_id: employeeResultId,
            daily_result_id: dailyId,
            source_kind: sourceKind,
            source_id: sourceRecordId,
            source_key: null,
            source_fingerprint: hashPayload(sourceId),
            source_snapshot: {
              sourceId,
              startedAt: interval?.startedAt ?? null,
              endedAt: interval?.endedAt ?? null,
              sourceSeconds: overlapSeconds,
              policyVersionId: policiesByDate.get(date)?.id ?? null,
              allocationKind: interval?.allocationKind ?? "unallocated",
              jobId: interval?.jobId ?? null,
              jobNumber: interval?.jobNumber ?? "",
              projectId: interval?.projectId ?? null,
              projectNumber: interval?.projectNumber ?? "",
            },
          });
        }
      });
    }
  }
  const { data: sourceFingerprint, error: fingerprintError } = await admin.rpc(
    "get_time_period_source_fingerprint",
    {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_start_date: bounds.start,
      p_period_end_date: bounds.end,
    },
  );
  if (fingerprintError || !sourceFingerprint)
    throw new Error(fingerprintError?.message ?? "fingerprint_failed");
  const operationId = randomUUID();
  const payload = { organizationId: context.orgId, bounds, sourceFingerprint };
  const { data: calculationId, error } = await admin.rpc(
    "prepare_time_period",
    {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_start_date: bounds.start,
      p_period_end_date: bounds.end,
      p_source_fingerprint: sourceFingerprint,
      p_employee_results: employeePayload,
      p_daily_results: dailyPayload,
      p_sources: sourcePayload,
      p_findings: findingPayload,
      p_operation_id: operationId,
      p_request_hash: hashPayload(payload),
    },
  );
  if (error) throw new Error(error.message);
  const { data: calculationRow } = await admin
    .from("time_period_calculations")
    .select("period_id")
    .eq("id", calculationId)
    .single();
  revalidatePath("/zeiterfassung/perioden");
  revalidatePath("/zeiterfassung/zeitkonto");
  if (calculationRow)
    redirect(`/zeiterfassung/perioden/${calculationRow.period_id}`);
}

export async function decidePeriodFinding(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const findingId = String(formData.get("findingId") ?? "");
  const periodId = String(formData.get("periodId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "Geprüft");
  if (
    !findingId ||
    !periodId ||
    !["approved", "rejected", "acknowledged"].includes(decision) ||
    !reason.trim()
  )
    throw new Error("invalid_finding_decision");
  const { error } = await createSupabaseAdminClient().rpc(
    "decide_time_period_finding",
    {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_finding_id: findingId,
      p_decision: decision as "approved" | "rejected" | "acknowledged",
      p_reason: reason,
      p_operation_id: randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
}

export async function closeTimePeriod(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const periodId = String(formData.get("periodId") ?? "");
  if (!periodId) throw new Error("invalid_period");
  const operationId = randomUUID();
  const { error } = await createSupabaseAdminClient().rpc("close_time_period", {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_period_id: periodId,
    p_operation_id: operationId,
    p_request_hash: hashPayload({ periodId }),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  revalidatePath("/zeiterfassung/zeitkonto");
}

export async function reopenTimePeriod(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin") throw new Error("forbidden");
  const periodId = String(formData.get("periodId") ?? "");
  const reason = String(formData.get("reason") ?? "Korrektur erforderlich");
  const operationId = randomUUID();
  const { error } = await createSupabaseAdminClient().rpc(
    "reopen_time_period",
    {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_id: periodId,
      p_reason: reason,
      p_operation_id: operationId,
      p_request_hash: hashPayload({ periodId, reason }),
    },
  );
  if (error) throw new Error(error.message);
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
  revalidatePath("/zeiterfassung/zeitkonto");
}

const PAYROLL_CODE_MAPPINGS = [
  ["target", null, "SOLL"],
  ["source_attendance", null, "ANWESEND"],
  ["effective_attendance", null, "EFFEKTIV"],
  ["vacation", null, "URLAUB"],
  ["sickness", null, "KRANK"],
  ["overtime", null, "MEHRARBEIT"],
  ["night_supplement", null, "NACHT"],
  ["sunday_supplement", null, "SONNTAG"],
  ["public_holiday_supplement", null, "FEIERTAG"],
  ["manual_adjustment", null, "KORREKTUR"],
  ["expiry", null, "VERFALL"],
  ["payout", null, "AUSZAHLUNG"],
  ["opening_balance", null, "START"],
  ["closing_balance", null, "SALDO"],
  ["credited_activity", "work", "ARBEIT"],
  ["credited_activity", "travel", "FAHRT"],
  ["credited_activity", "break", "PAUSE"],
  ["credited_activity", "standby", "BEREITSCHAFT"],
  ["credited_activity", "callout", "EINSATZ"],
  ["credited_activity", "internal_activity", "INTERN"],
].map(([valueKind, activityKind, outputCode]) => ({
  value_kind: valueKind,
  activity_kind: activityKind,
  output_code: outputCode,
}));

export async function createDefaultPayrollMapping(): Promise<void> {
  const context = await requireAuth();
  if (context.role !== "admin") throw new Error("forbidden");
  const admin = createSupabaseAdminClient();
  const { data: employees } = await admin
    .from("employee_records")
    .select("id, employee_number")
    .eq("organization_id", context.orgId)
    .order("created_at");
  const employeeWithoutNumber = (employees ?? []).find(
    (employee) => !employee.employee_number,
  );
  if (employeeWithoutNumber) throw new Error("employee_number_required");
  const employeeMappings = (employees ?? []).map((employee) => ({
    employee_record_id: employee.id,
    external_employee_reference: employee.employee_number!,
  }));
  const operationId = randomUUID();
  const payload = { employeeMappings, codeMappings: PAYROLL_CODE_MAPPINGS };
  const { error } = await admin.rpc("create_payroll_mapping_version", {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_employee_mappings: employeeMappings,
    p_code_mappings: PAYROLL_CODE_MAPPINGS,
    p_operation_id: operationId,
    p_request_hash: hashPayload(payload),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/zeiterfassung/einstellungen");
  revalidatePath("/einstellungen/zeiterfassung");
}

export async function generatePayrollExport(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const periodId = String(formData.get("periodId") ?? "");
  if (!periodId) throw new Error("invalid_period");
  const admin = createSupabaseAdminClient();
  const { data: period } = await admin
    .from("time_periods")
    .select("*")
    .eq("id", periodId)
    .eq("organization_id", context.orgId)
    .single();
  if (!period?.current_calculation_id || !period.current_close_version_id)
    throw new Error("period_not_closed");
  const { data: profile } = await admin
    .from("payroll_mapping_profiles")
    .select("current_version_id")
    .eq("organization_id", context.orgId)
    .single();
  if (!profile?.current_version_id) throw new Error("mapping_not_configured");
  const [
    { data: calculation },
    { data: closeVersion },
    { data: mappingVersion },
    { data: employeeMappings },
    { data: codeMappings },
    { data: employeeResults },
  ] = await Promise.all([
    admin
      .from("time_period_calculations")
      .select("*")
      .eq("id", period.current_calculation_id)
      .single(),
    admin
      .from("time_period_close_versions")
      .select("*")
      .eq("id", period.current_close_version_id)
      .single(),
    admin
      .from("payroll_mapping_versions")
      .select("*")
      .eq("id", profile.current_version_id)
      .single(),
    admin
      .from("payroll_employee_mappings")
      .select("*")
      .eq("mapping_version_id", profile.current_version_id),
    admin
      .from("payroll_code_mappings")
      .select("*")
      .eq("mapping_version_id", profile.current_version_id),
    admin
      .from("time_period_employee_results")
      .select("*")
      .eq("calculation_id", period.current_calculation_id),
  ]);
  if (!calculation || !closeVersion || !mappingVersion)
    throw new Error("export_context_missing");
  const employeeResultIds = (employeeResults ?? []).map((result) => result.id);
  const employeeIds = (employeeResults ?? []).map(
    (result) => result.employee_record_id,
  );
  const [
    { data: dailyResults },
    { data: resultSources },
    { data: accountEvents },
    { data: correctionRequests },
  ] = await Promise.all([
    employeeResultIds.length > 0
      ? admin
          .from("time_period_daily_results")
          .select("*")
          .in("employee_result_id", employeeResultIds)
      : Promise.resolve({ data: [] }),
    employeeResultIds.length > 0
      ? admin
          .from("time_period_result_sources")
          .select("*")
          .in("employee_result_id", employeeResultIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? admin
          .from("time_account_events")
          .select("*")
          .eq("organization_id", context.orgId)
          .in("employee_record_id", employeeIds)
          .gte("effective_date", period.period_start_date)
          .lte("effective_date", period.period_end_date)
          .in("event_kind", [
            "opening_balance",
            "manual_adjustment",
            "expiry",
            "payout",
          ])
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? admin
          .from("time_correction_requests")
          .select("id, subject_employee_record_id")
          .eq("organization_id", context.orgId)
          .in("subject_employee_record_id", employeeIds)
      : Promise.resolve({ data: [] }),
  ]);
  const correctionRequestIds = (correctionRequests ?? []).map(
    (request) => request.id,
  );
  const { data: correctionApplications } = correctionRequestIds.length
    ? await admin
        .from("time_correction_applications")
        .select(
          "id, request_id, revision, source_fingerprint, applied_snapshot",
        )
        .eq("organization_id", context.orgId)
        .in("request_id", correctionRequestIds)
    : { data: [] };
  const externalByEmployee = new Map(
    (employeeMappings ?? []).map((mapping) => [
      mapping.employee_record_id,
      mapping.external_employee_reference,
    ]),
  );
  for (const employeeId of employeeIds) {
    if (!externalByEmployee.get(employeeId)?.trim())
      throw new Error("payroll_employee_mapping_missing");
  }
  const codeByKey = new Map(
    (codeMappings ?? []).map((mapping) => [
      `${mapping.value_kind}|${mapping.activity_kind ?? ""}`,
      mapping.output_code,
    ]),
  );
  const resultById = new Map(
    (employeeResults ?? []).map((result) => [result.id, result]),
  );
  const resultByEmployeeRecordId = new Map(
    (employeeResults ?? []).map((result) => [
      result.employee_record_id,
      result,
    ]),
  );
  const dailyById = new Map(
    (dailyResults ?? []).map((daily) => [daily.id, daily]),
  );
  const requestEmployeeById = new Map(
    (correctionRequests ?? []).map((request) => [
      request.id,
      request.subject_employee_record_id,
    ]),
  );
  const outputCodeFor = (valueKind: string, activityKind = ""): string =>
    codeByKey.get(`${valueKind}|${activityKind}`) ??
    codeByKey.get(`${valueKind}|`) ??
    "";
  const valueRows: PayrollExportValueRow[] = [];
  const appendValue = (input: {
    rowId: string;
    employeeRecordId: string;
    localDate: string;
    valueKind: PayrollValueKind;
    activityKind?: string;
    sourceSeconds?: number;
    minutes: number;
    roundingDeltaSeconds?: number;
    policyVersionId: string;
  }): void => {
    if (input.minutes === 0 && (input.sourceSeconds ?? 0) === 0) return;
    valueRows.push({
      rowId: input.rowId,
      employeeRecordId: input.employeeRecordId,
      externalEmployeeReference: externalByEmployee.get(
        input.employeeRecordId,
      )!,
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
  for (const daily of dailyResults ?? []) {
    const result = resultById.get(daily.employee_result_id);
    if (!result) continue;
    const common = {
      employeeRecordId: daily.employee_record_id,
      localDate: daily.local_date,
      policyVersionId: result.policy_version_id ?? "",
    };
    appendValue({
      ...common,
      rowId: `${daily.id}:source`,
      valueKind: "source_attendance",
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.source_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:effective`,
      valueKind: "effective_attendance",
      sourceSeconds: Number(daily.credited_seconds),
      minutes: daily.credited_minutes,
    });
    appendValue({
      ...common,
      rowId: `${daily.id}:credited`,
      valueKind: "credited_activity",
      activityKind: daily.activity_kind,
      sourceSeconds: Number(daily.source_seconds),
      minutes: daily.credited_minutes,
      roundingDeltaSeconds: Number(daily.rounding_delta_seconds),
    });
    for (const [valueKind, minutes] of [
      ["vacation", daily.vacation_minutes],
      ["sickness", daily.sickness_minutes],
      ["night_supplement", daily.night_minutes],
      ["sunday_supplement", daily.sunday_minutes],
      ["public_holiday_supplement", daily.public_holiday_minutes],
    ] as const)
      appendValue({
        ...common,
        rowId: `${daily.id}:${valueKind}`,
        valueKind,
        minutes,
      });
  }
  for (const result of employeeResults ?? []) {
    const common = {
      employeeRecordId: result.employee_record_id,
      localDate: period.period_end_date,
      policyVersionId: result.policy_version_id ?? "",
    };
    appendValue({
      ...common,
      rowId: `${result.id}:target`,
      valueKind: "target",
      minutes: result.target_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:overtime`,
      valueKind: "overtime",
      minutes: result.overtime_candidate_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:opening`,
      valueKind: "opening_balance",
      minutes: result.previous_balance_minutes,
    });
    appendValue({
      ...common,
      rowId: `${result.id}:closing`,
      valueKind: "closing_balance",
      minutes: result.closing_balance_minutes,
    });
  }
  for (const event of accountEvents ?? []) {
    const result = resultByEmployeeRecordId.get(event.employee_record_id);
    appendValue({
      rowId: `${event.id}:${event.event_kind}`,
      employeeRecordId: event.employee_record_id,
      localDate: event.effective_date,
      valueKind: event.event_kind,
      minutes: event.minutes,
      policyVersionId: result?.policy_version_id ?? "",
    });
  }
  const allocationMinutesBySourceId = new Map<string, number>();
  const sourcesByDailyResultId = new Map<
    string,
    Array<NonNullable<typeof resultSources>[number]>
  >();
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
          (source.source_snapshot as unknown as Record<string, unknown>)
            .sourceSeconds ?? 0,
        ),
      })),
      daily.credited_minutes,
    );
    for (const [sourceId, minutes] of distribution)
      allocationMinutesBySourceId.set(sourceId, minutes);
  }
  const allocationRows: PayrollExportAllocationRow[] = (
    resultSources ?? []
  ).flatMap((source) => {
    if (!source.daily_result_id) return [];
    const daily = dailyById.get(source.daily_result_id);
    const result = resultById.get(source.employee_result_id);
    if (!daily || !result) return [];
    const snapshot = source.source_snapshot as unknown as Record<
      string,
      unknown
    >;
    const sourceSeconds = Number(snapshot.sourceSeconds ?? 0);
    const creditedMinutes = allocationMinutesBySourceId.get(source.id) ?? 0;
    return [
      {
        rowId: source.id,
        employeeRecordId: result.employee_record_id,
        externalEmployeeReference: externalByEmployee.get(
          result.employee_record_id,
        )!,
        localDate: daily.local_date,
        activityKind: daily.activity_kind,
        sourceReference: `${source.source_kind}:${source.source_id ?? source.source_key}`,
        sourceSeconds,
        creditedMinutes,
        allocationKind: String(snapshot.allocationKind ?? "unallocated"),
        jobNumber: String(snapshot.jobNumber ?? ""),
        projectNumber: String(snapshot.projectNumber ?? ""),
      },
    ];
  });
  const correctionRows: PayrollExportCorrectionRow[] = (
    correctionApplications ?? []
  ).flatMap((application) => {
    const employeeRecordId = requestEmployeeById.get(application.request_id);
    const snapshot = application.applied_snapshot as unknown as {
      facts?: Array<{ timestamp?: string }>;
    };
    const affectsPeriod = (snapshot.facts ?? []).some(
      (fact) =>
        typeof fact.timestamp === "string" &&
        fact.timestamp >=
          getBerlinInstant(`${period.period_start_date}T00:00`) &&
        fact.timestamp <
          getBerlinInstant(`${addLocalDays(period.period_end_date, 1)}T00:00`),
    );
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
  });
  valueRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  allocationRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  correctionRows.sort((left, right) => left.rowId.localeCompare(right.rowId));
  const contentFingerprint = hashPayload({
    periodId,
    closeVersion: closeVersion.id,
    mappingVersion: mappingVersion.id,
    valueRows,
    allocationRows,
    correctionRows,
  });
  const { data: latestReadyExport } = await admin
    .from("payroll_exports")
    .select("id, close_version_id, content_fingerprint")
    .eq("organization_id", context.orgId)
    .eq("period_id", periodId)
    .eq("state", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    latestReadyExport?.close_version_id === closeVersion.id &&
    latestReadyExport?.content_fingerprint === contentFingerprint
  ) {
    revalidatePath(`/zeiterfassung/perioden/${periodId}`);
    return;
  }
  const supersedesExportId = latestReadyExport?.id ?? null;
  const operationId = randomUUID();
  const { data: exportId, error: reserveError } = await admin.rpc(
    "reserve_payroll_export",
    {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_id: periodId,
      p_mapping_version_id: mappingVersion.id,
      p_generator_version: "p1-23-v1",
      p_content_fingerprint: contentFingerprint,
      p_supersedes_export_id: supersedesExportId,
      p_operation_id: operationId,
      p_request_hash: hashPayload({ periodId, contentFingerprint }),
    },
  );
  if (reserveError || !exportId)
    throw new Error(reserveError?.message ?? "export_reservation_failed");
  const { data: exportRow, error: exportRowError } = await admin
    .from("payroll_exports")
    .select("version")
    .eq("id", exportId)
    .single();
  if (exportRowError || !exportRow)
    throw new Error(exportRowError?.message ?? "export_reservation_missing");
  const generatedAt = closeVersion.created_at;
  const packageResult = buildPayrollExportPackage({
    manifest: {
      schemaVersion: 1,
      exportId,
      exportVersion: exportRow.version,
      supersedesExportId,
      organizationId: context.orgId,
      periodStart: period.period_start_date,
      periodEnd: period.period_end_date,
      closeVersion: closeVersion.version,
      mappingVersion: mappingVersion.version,
      generatorVersion: "p1-23-v1",
      generatedAt,
      scope: "organization_period",
    },
    valueRows,
    allocationRows,
    correctionRows,
  });
  const storagePath = `${context.orgId}/lohnexporte/${period.period_start_date}/${exportId}.zip`;
  let stored = false;
  try {
    await putStorageObject({
      path: storagePath,
      body: packageResult.bytes,
      contentType: "application/zip",
    });
    stored = true;
    const documentId = randomUUID();
    const fileName = `Lohnexport-${period.period_start_date}.zip`;
    const { error: documentError } = await admin.from("documents").insert({
      id: documentId,
      organization_id: context.orgId,
      storage_path: storagePath,
      original_file_name: fileName,
      display_name: fileName,
      mime_type: "application/zip",
      size_bytes: packageResult.bytes.length,
      uploaded_by: context.userId,
      metadata: {
        kind: "payroll_export",
        exportId,
        sha256: packageResult.sha256,
      },
    });
    if (documentError) throw documentError;
    const { error: finalizeError } = await admin.rpc(
      "finalize_payroll_export",
      {
        p_actor_id: context.userId,
        p_organization_id: context.orgId,
        p_export_id: exportId,
        p_document_id: documentId,
        p_zip_sha256: packageResult.sha256,
        p_size_bytes: packageResult.bytes.length,
        p_operation_id: randomUUID(),
      },
    );
    if (finalizeError) throw finalizeError;
  } catch (error) {
    if (stored)
      await deleteStorageObjects([storagePath]).catch(() => undefined);
    await admin.rpc("fail_payroll_export", {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_export_id: exportId,
      p_failure_reason:
        error instanceof Error ? error.message : "generation_failed",
      p_operation_id: randomUUID(),
    });
    throw error;
  }
  revalidatePath(`/zeiterfassung/perioden/${periodId}`);
}

export async function downloadPayrollExport(formData: FormData): Promise<void> {
  const context = await requireAuth();
  if (!(await canManageTimeAccounts(context))) throw new Error("forbidden");
  const exportId = String(formData.get("exportId") ?? "");
  if (!exportId) throw new Error("invalid_export");
  const admin = createSupabaseAdminClient();
  const { data: exportRow } = await admin
    .from("payroll_exports")
    .select("document_id")
    .eq("id", exportId)
    .eq("organization_id", context.orgId)
    .eq("state", "ready")
    .single();
  if (!exportRow?.document_id) throw new Error("export_not_ready");
  const { data: document } = await admin
    .from("documents")
    .select("storage_path, original_file_name")
    .eq("id", exportRow.document_id)
    .eq("organization_id", context.orgId)
    .single();
  if (!document) throw new Error("document_not_found");
  const url = await createSignedDownloadUrl({
    path: document.storage_path,
    disposition: "attachment",
    downloadFileName: document.original_file_name,
  });
  redirect(url);
}
