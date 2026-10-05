import 'server-only';

// P1-23 period preparation: reads every period source, resolves policies and
// daily targets, and computes the employee, daily, source, and finding rows
// that the prepare_time_period RPC stores. This is an internal server module,
// not a Server Action: prepareTimePeriod authorizes the caller and passes the
// admin client in. The source reads, their grouping, and the row order are the
// payroll-relevant contract; change them only together with that action.

import { createHash, randomUUID } from 'node:crypto';
import { buildLegacyIntervals } from './legacy-intervals';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { addLocalDays, resolveBerlinWallTime } from '@/lib/planning/date-time';
import { toBusinessIsoDate, toEmploymentCondition } from '@/lib/personnel/types';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import { resolveDailyTarget, type DailyTarget } from '@/lib/personnel/targets';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  hasUnclosedLegacySequence,
  projectLegacyEntriesForWindow,
} from '@/lib/time-accounts/legacy-projection';
import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionSource,
} from '@/lib/time-corrections/types';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import { calculateEmployeePeriod } from './calculation';
import type {
  DailyTargetInput,
  EmployeePeriodCalculation,
  TimeAccountPolicy,
  TimeActivityInterval,
  TimeCreditRule,
} from './types';
import { requirePresent } from './validation';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;
type PeriodBounds = { start: string; end: string; endExclusive: string };

type TimePeriodPreparationPayload = {
  employeePayload: Array<Record<string, unknown>>;
  dailyPayload: Array<Record<string, unknown>>;
  sourcePayload: Array<Record<string, unknown>>;
  findingPayload: Array<Record<string, unknown>>;
};

// P1-23 intentionally fixes the break-warning threshold at six hours.
const BREAK_REQUIRED_ABOVE_MINUTES = 360;

// PostgREST truncates at 1,000 rows without an error, and a period computed or
// exported from a partial read is silently wrong payroll. One month of segments
// for a few hundred employees exceeds LIST_ROW_CAP, so period sources declare
// their own bound and a failed or overflowing read stops the action.
export const PERIOD_SOURCE_ROW_CAP = 200_000;
export function requirePeriodRows<Row>(result: { data: Row[]; error: { message: string } | null }): {
  data: Row[];
} {
  if (result.error) throw new Error(`period_source_incomplete: ${result.error.message}`);
  return result;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

export function getBerlinInstant(localDateTime: string): string {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error('invalid_berlin_time');
  return resolved.instant.toISOString();
}

function toLegacyEntries(rows: Array<Record<string, unknown>>): TimeEntry[] {
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: String(row.organization_id),
    entryType: String(row.entry_type) as TimeEntry['entryType'],
    timestamp: String(row.timestamp),
    isManual: Boolean(row.is_manual),
    status: String(row.status) as TimeEntry['status'],
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    originalTimestamp: row.original_timestamp ? String(row.original_timestamp) : null,
    jobId: row.job_id ? String(row.job_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
  }));
}

async function resolvePoliciesForPeriod(
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, Map<string, TimeAccountPolicy | null>>> {
  const admin = createSupabaseAdminClient();
  const [{ data: assignments }, { data: policies }] = await Promise.all([
    // An employee sits in one batch, so the newest assignment still comes first.
    readInBatches(employeeRecordIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_account_policy_assignments')
            .select('employee_record_id, policy_id, valid_from, valid_until')
            .eq('organization_id', organizationId)
            .in('employee_record_id', [...batch])
            .lte('valid_from', periodEnd)
            .or(`valid_until.is.null,valid_until.gte.${periodStart}`)
            .order('valid_from', { ascending: false })
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_account_policies')
          .select('id, is_default, retired_at')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ]);
  const defaultPolicyId = (policies ?? []).find((policy) => policy.is_default && !policy.retired_at)?.id;
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
        new Map(getDateRange(periodStart, periodEnd).map((date) => [date, null])),
      ]),
    );
  const { data: versions } = await readInBatches(policyIds, (batch) =>
    admin
      .from('time_account_policy_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .in('policy_id', [...batch])
      .lte('effective_from', periodEnd)
      .order('effective_from', { ascending: false })
      .order('version', { ascending: false }),
  ).then(requirePeriodRows);
  const versionIds = (versions ?? []).map((version) => version.id);
  if (versionIds.length === 0)
    return new Map(
      employeeRecordIds.map((id) => [
        id,
        new Map(getDateRange(periodStart, periodEnd).map((date) => [date, null])),
      ]),
    );
  const [{ data: credits }, { data: supplements }, { data: warnings }] = await Promise.all([
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_credit_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_supplement_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_warning_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
  ]);
  const policyByVersionId = new Map<string, TimeAccountPolicy>();
  for (const version of versions ?? []) {
    const versionCredits = (credits ?? []).filter((rule) => rule.policy_version_id === version.id);
    const versionSupplements = (supplements ?? []).filter((rule) => rule.policy_version_id === version.id);
    const versionWarnings = (warnings ?? []).filter((warning) => warning.policy_version_id === version.id);
    const creditRules: TimeCreditRule[] = versionCredits.map((rule) => {
      if (rule.activity_kind === 'travel')
        return {
          activityKind: 'travel',
          travelRoute: requirePresent(rule.travel_route, 'policy_credit_rule_incomplete'),
          travelRole: requirePresent(rule.travel_role, 'policy_credit_rule_incomplete'),
          percentage: rule.credit_percentage as 0 | 50 | 100,
        };
      if (rule.activity_kind === 'standby')
        return {
          activityKind: 'standby',
          standbyContext: requirePresent(rule.standby_context, 'policy_credit_rule_incomplete'),
          percentage: rule.credit_percentage as 0 | 50 | 100,
        };
      return {
        activityKind: rule.activity_kind as Exclude<TimeSegmentKind, 'travel' | 'standby'>,
        percentage: rule.credit_percentage as 0 | 50 | 100,
      };
    });
    policyByVersionId.set(version.id, {
      id: version.id,
      version: version.version,
      effectiveFrom: version.effective_from,
      creditRules,
      supplementRules: (['night', 'sunday', 'public_holiday'] as const).map((kind) => ({
        supplementKind: kind,
        enabled: versionSupplements.some((rule) => rule.supplement_kind === kind && rule.enabled),
        eligibleActivityKinds: versionSupplements
          .filter((rule) => rule.supplement_kind === kind && rule.enabled)
          .map((rule) => rule.activity_kind),
      })),
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
          candidate.valid_from <= date && (candidate.valid_until === null || candidate.valid_until >= date),
      );
      const policyId = assignment?.policy_id ?? defaultPolicyId;
      const version = (versions ?? []).find(
        (candidate) => candidate.policy_id === policyId && candidate.effective_from <= date,
      );
      byDate.set(date, version ? (policyByVersionId.get(version.id) ?? null) : null);
    }
    result.set(employeeRecordId, byDate);
  }
  return result;
}

// Time and account sources; started in the same order as before the split so
// the combined Promise.all below keeps one read group.
function startPeriodActivityReads(
  admin: SupabaseAdmin,
  context: { orgId: string },
  bounds: PeriodBounds,
  startInstant: string,
  endInstant: string,
) {
  return [
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select('*')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_accounts')
          .select('*')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_account_events')
          .select('*')
          .eq('organization_id', context.orgId)
          .lte('effective_date', bounds.end)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_segments')
          .select('*')
          .eq('organization_id', context.orgId)
          .lt('started_at', endInstant)
          .not('ended_at', 'is', null)
          .gt('ended_at', startInstant)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_sessions')
          .select('id, employee_record_id, status, started_at')
          .eq('organization_id', context.orgId)
          .in('status', ['open', 'recovery_required'])
          .lt('started_at', endInstant)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_entries')
          .select('*')
          .eq('organization_id', context.orgId)
          .is('operation_id', null)
          .gte('timestamp', getBerlinInstant(`${addLocalDays(bounds.start, -1)}T00:00`))
          .lt('timestamp', endInstant)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ] as const;
}

function startPeriodReferenceReads(admin: SupabaseAdmin, context: { orgId: string }, bounds: PeriodBounds) {
  return [
    readCompleteRows(
      (from, to) =>
        admin
          .from('work_schedules')
          .select('*')
          .eq('organization_id', context.orgId)
          .lte('valid_from', bounds.end)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('employment_conditions')
          .select('*')
          .eq('organization_id', context.orgId)
          .lte('valid_from', bounds.end)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, job_number, project_id')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('projects')
          .select('id, project_number')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_applications')
          .select('*')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_request_sources')
          .select('*')
          .eq('organization_id', context.orgId)
          .order('request_id')
          .order('revision')
          .order('ordinal')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_requests')
          .select('id, subject_employee_record_id, current_revision, status')
          .eq('organization_id', context.orgId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_request_revisions')
          .select('request_id, revision, proposed_snapshot')
          .eq('organization_id', context.orgId)
          .order('request_id')
          .order('revision')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ] as const;
}

async function loadPeriodSources(
  admin: SupabaseAdmin,
  context: { orgId: string },
  bounds: PeriodBounds,
  startInstant: string,
  endInstant: string,
) {
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
    ...startPeriodActivityReads(admin, context, bounds, startInstant, endInstant),
    ...startPeriodReferenceReads(admin, context, bounds),
    getCachedOrganizationCalendar(context.orgId),
    loadApprovedVacationSpansByRecord(context.orgId, bounds.start, bounds.end),
    loadActiveSicknessSpansByRecord(context.orgId, bounds.start, bounds.end),
  ]);
  // A failed absence read is not "no absence": it would raise every target.
  if (!vacations || !sickness) throw new Error('period_source_incomplete: absences');
  return {
    employees,
    accounts,
    accountEvents,
    segments,
    sessions,
    legacyRows,
    schedules,
    conditions,
    jobs,
    projects,
    correctionApplications,
    correctionSources,
    correctionRequests,
    correctionRevisions,
    calendar,
    vacations,
    sickness,
  };
}

type PeriodSources = Awaited<ReturnType<typeof loadPeriodSources>>;
type PeriodEmployee = PeriodSources['employees'][number];

function indexPeriodSources(
  sources: PeriodSources,
  context: { orgId: string },
  bounds: PeriodBounds,
  endInstant: string,
) {
  const { accounts, accountEvents, correctionSources, correctionApplications, legacyRows } = sources;
  const { employees, projects, jobs } = sources;
  const accountByEmployee = new Map((accounts ?? []).map((account) => [account.employee_record_id, account]));
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
  const approvedCorrectionApplications: TimeCorrectionApplicationProjection[] = (
    correctionApplications ?? []
  ).flatMap((application) => {
    if (!isTimeCorrectionSnapshot(application.applied_snapshot)) return [];
    return [
      {
        applicationId: application.id,
        requestId: application.request_id,
        appliedAt: application.applied_at,
        appliedBy: application.applied_by,
        sourceFingerprint: application.source_fingerprint,
        snapshot: application.applied_snapshot,
        sources: correctionSourcesByRevision.get(`${application.request_id}:${application.revision}`) ?? [],
      },
    ];
  });
  const suppressedSegmentIds = new Set(
    approvedCorrectionApplications.flatMap((application) =>
      application.sources.flatMap((source) => (source.kind === 'canonical_segment' ? [source.id] : [])),
    ),
  );
  const effectiveEntries = projectLegacyEntriesForWindow({
    entries: toLegacyEntries((legacyRows ?? []) as Array<Record<string, unknown>>),
    applications: approvedCorrectionApplications,
    organizationId: context.orgId,
    startInstant: getBerlinInstant(`${addLocalDays(bounds.start, -1)}T00:00`),
    endInstant,
  });
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
  const projectNumberById = new Map((projects ?? []).map((project) => [project.id, project.project_number]));
  const jobById = new Map((jobs ?? []).map((job) => [job.id, job]));
  const dates = getDateRange(bounds.start, bounds.end);
  const dateBounds = new Map(
    dates.map((date) => [
      date,
      {
        start: new Date(getBerlinInstant(`${date}T00:00`)).getTime(),
        end: new Date(getBerlinInstant(`${addLocalDays(date, 1)}T00:00`)).getTime(),
      },
    ]),
  );
  return {
    accountByEmployee,
    eventsByEmployee,
    legacyByUser,
    suppressedSegmentIds,
    periodEmployees,
    projectNumberById,
    jobById,
    dates,
    dateBounds,
  };
}

type PeriodIndex = ReturnType<typeof indexPeriodSources>;
type PeriodPolicies = Map<string, TimeAccountPolicy | null>;
type PeriodShared = {
  bounds: PeriodBounds;
  startInstant: string;
  endInstant: string;
  sources: PeriodSources;
  index: PeriodIndex;
  payloads: TimePeriodPreparationPayload;
};

function buildEmployeeActivityIntervals(
  employee: PeriodEmployee,
  shared: PeriodShared,
): TimeActivityInterval[] {
  const { segments } = shared.sources;
  const { suppressedSegmentIds, jobById, projectNumberById, legacyByUser } = shared.index;
  const employeeSegments = (segments ?? []).filter(
    (segment) => segment.employee_record_id === employee.id && !suppressedSegmentIds.has(segment.id),
  );
  const intervals: TimeActivityInterval[] = employeeSegments.map((segment) => {
    const job = segment.job_id ? jobById.get(segment.job_id) : undefined;
    const projectId = job?.project_id ?? undefined;
    const jobNumber = job?.job_number;
    const projectNumber = projectId ? projectNumberById.get(projectId) : undefined;
    return {
      sourceId: `segment:${segment.id}`,
      startedAt: segment.started_at,
      endedAt: requirePresent(segment.ended_at, 'period_segment_open'),
      activityKind: segment.kind,
      travelRoute: segment.travel_route ?? undefined,
      travelRole: segment.travel_role ?? undefined,
      standbyContext: segment.standby_context ?? undefined,
      allocationKind: segment.allocation_kind,
      jobId: segment.job_id ?? undefined,
      ...(typeof jobNumber === 'string' ? { jobNumber } : {}),
      projectId,
      ...(typeof projectNumber === 'string' ? { projectNumber } : {}),
    };
  });
  if (employee.user_id)
    intervals.push(...buildLegacyIntervals(legacyByUser.get(employee.user_id) ?? [], employee.id));
  for (const interval of intervals) {
    if (!interval.jobId || interval.jobNumber) continue;
    const job = jobById.get(interval.jobId);
    const projectId = job?.project_id ?? interval.projectId;
    const jobNumber = job?.job_number;
    const projectNumber = projectId ? projectNumberById.get(projectId) : undefined;
    if (typeof jobNumber === 'string') interval.jobNumber = jobNumber;
    interval.projectId = projectId;
    if (typeof projectNumber === 'string') interval.projectNumber = projectNumber;
    else delete interval.projectNumber;
  }
  return intervals;
}

function resolveEmployeeDailyTargets(
  employee: PeriodEmployee,
  policiesByDate: PeriodPolicies,
  shared: PeriodShared,
): { resolvedTargets: DailyTarget[]; dailyTargets: DailyTargetInput[] } {
  const { schedules, conditions, vacations, sickness, calendar } = shared.sources;
  const { dates } = shared.index;
  const employeeSchedules = (schedules ?? [])
    .filter((schedule) => schedule.employee_record_id === employee.id)
    .map(toWorkSchedule);
  const employeeConditions = (conditions ?? [])
    .filter((condition) => condition.employee_record_id === employee.id)
    .map(toEmploymentCondition);
  const absenceSpans = [...(vacations.get(employee.id) ?? []), ...(sickness.get(employee.id) ?? [])];
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
      target.absence?.type === 'vacation' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const sicknessMinutes =
      target.absence?.type === 'sickness' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const treatment =
      target.absence?.type === 'vacation'
        ? policiesByDate.get(target.date)?.vacationTreatment
        : policiesByDate.get(target.date)?.sicknessTreatment;
    const targetMinutes =
      target.absence && treatment === 'informational' ? target.baseTargetMinutes : target.targetMinutes;
    return {
      localDate: target.date,
      targetMinutes,
      source:
        target.source === 'schedule'
          ? 'schedule'
          : target.source === 'derived'
            ? 'employment_condition'
            : 'default',
      vacationMinutes,
      sicknessMinutes,
    };
  });
  return { resolvedTargets, dailyTargets };
}

function calculateEmployeePeriodResult(input: {
  employee: PeriodEmployee;
  policy: TimeAccountPolicy | null;
  account: PeriodSources['accounts'][number] | undefined;
  hasCompletePolicyHistory: boolean;
  policiesByDate: PeriodPolicies;
  intervals: TimeActivityInterval[];
  resolvedTargets: DailyTarget[];
  dailyTargets: DailyTargetInput[];
  shared: PeriodShared;
}): EmployeePeriodCalculation {
  const { employee, policy, account, hasCompletePolicyHistory, policiesByDate, intervals } = input;
  const { resolvedTargets, dailyTargets } = input;
  const { bounds } = input.shared;
  const { eventsByEmployee } = input.shared.index;
  const employeeEvents = eventsByEmployee.get(employee.id) ?? [];
  const previousBalanceMinutes = employeeEvents
    .filter((event) => event.effective_date < bounds.start)
    .reduce((sum, event) => sum + event.minutes, 0);
  const eventInputs = employeeEvents
    .filter(
      (event) =>
        event.effective_date >= bounds.start &&
        ['opening_balance', 'manual_adjustment', 'expiry', 'payout'].includes(event.event_kind),
    )
    .map((event) => ({
      id: event.id,
      kind: event.event_kind as 'opening_balance' | 'manual_adjustment' | 'expiry' | 'payout',
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
        resolvedTargets.filter((target) => target.isHoliday).map((target) => target.date),
      ),
    });
  } else {
    calculation = {
      employeeRecordId: employee.id,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      policyId: policy?.id ?? '',
      policyVersion: policy?.version ?? 0,
      activityBuckets: [],
      supplementBuckets: [],
      targetMinutes: dailyTargets.reduce((sum, target) => sum + target.targetMinutes, 0),
      sourceMinutes: 0,
      creditedMinutes: 0,
      vacationMinutes: dailyTargets.reduce((sum, target) => sum + target.vacationMinutes, 0),
      sicknessMinutes: dailyTargets.reduce((sum, target) => sum + target.sicknessMinutes, 0),
      accountEventMinutes: 0,
      periodDeltaMinutes: 0,
      overtimeCandidateMinutes: 0,
      previousBalanceMinutes,
      closingBalanceMinutes: previousBalanceMinutes,
      hasAuthoritativeTargets: false,
    };
  }
  return calculation;
}

function pushEmployeeIntegrityFindings(input: {
  employee: PeriodEmployee;
  policy: TimeAccountPolicy | null;
  account: PeriodSources['accounts'][number] | undefined;
  hasCompletePolicyHistory: boolean;
  policiesByDate: PeriodPolicies;
  calculation: EmployeePeriodCalculation;
  sortedIntervals: TimeActivityInterval[];
  shared: PeriodShared;
}): void {
  const { employee, policy, account, hasCompletePolicyHistory, policiesByDate, calculation } = input;
  const { sortedIntervals } = input;
  const { findingPayload } = input.shared.payloads;
  const { sessions } = input.shared.sources;
  const { dates, legacyByUser } = input.shared.index;
  if (!policy || !hasCompletePolicyHistory)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_policy',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_policy',
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
      finding_kind: 'missing_opening_balance',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_account',
      }),
      explanation: {},
    });
  if (!calculation.hasAuthoritativeTargets)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_schedule',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_schedule',
      }),
      explanation: {},
    });
  const openSession = (sessions ?? []).find((session) => session.employee_record_id === employee.id);
  if (openSession)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: openSession.status === 'recovery_required' ? 'recovery_session' : 'open_session',
      severity: 'close_blocked',
      source_fingerprint: hashPayload(openSession),
      explanation: { startedAt: openSession.started_at },
    });
  const effectiveEmployeeEntries = employee.user_id ? (legacyByUser.get(employee.user_id) ?? []) : [];
  if (hasUnclosedLegacySequence(effectiveEmployeeEntries))
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_clock',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_clock',
        entries: effectiveEmployeeEntries.map((entry) => entry.id),
      }),
      explanation: {},
    });
  const overlap = sortedIntervals.find(
    (interval, index) => index > 0 && interval.startedAt < (sortedIntervals[index - 1]?.endedAt ?? ''),
  );
  if (overlap)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'overlap',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'overlap',
        sourceId: overlap.sourceId,
      }),
      explanation: { sourceId: overlap.sourceId },
    });
}

function pushEmployeeReviewFindings(input: {
  employee: PeriodEmployee;
  calculation: EmployeePeriodCalculation;
  intervals: TimeActivityInterval[];
  targetsByDate: Map<string, DailyTargetInput>;
  shared: PeriodShared;
}): void {
  const { employee, calculation, intervals, targetsByDate } = input;
  const { startInstant, endInstant } = input.shared;
  const { findingPayload } = input.shared.payloads;
  const { correctionRequests, correctionRevisions } = input.shared.sources;
  const unallocated = intervals.filter(
    (interval) =>
      interval.allocationKind === 'unallocated' &&
      !['break', 'standby', 'internal_activity'].includes(interval.activityKind),
  );
  if (unallocated.length > 0)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'unallocated_time',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        sources: unallocated.map((interval) => interval.sourceId).sort(),
      }),
      explanation: { count: unallocated.length },
    });
  const pendingRequests = (correctionRequests ?? []).filter(
    (request) =>
      request.subject_employee_record_id === employee.id &&
      ['submitted', 'clarification_required'].includes(request.status),
  );
  // Merged snapshots mix `+00:00` database text with `Z` ISO text; compare
  // instants, not strings. Start inclusive, end exclusive.
  const periodStart = Date.parse(startInstant);
  const periodEnd = Date.parse(endInstant);
  const pendingRequest = pendingRequests.find((request) => {
    const revision = (correctionRevisions ?? []).find(
      (item) => item.request_id === request.id && item.revision === request.current_revision,
    );
    return (
      revision &&
      isTimeCorrectionSnapshot(revision.proposed_snapshot) &&
      revision.proposed_snapshot.facts.some((fact) => {
        const instant = Date.parse(fact.timestamp);
        return instant >= periodStart && instant < periodEnd;
      })
    );
  });
  if (pendingRequest)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'pending_correction',
      severity: 'close_blocked',
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
      finding_kind: 'absence_conflict',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        dates: [...new Set(absenceConflictDates)].sort(),
      }),
      explanation: { dates: [...new Set(absenceConflictDates)].sort() },
    });
}

function pushEmployeeWarningFindings(input: {
  employee: PeriodEmployee;
  policiesByDate: PeriodPolicies;
  calculation: EmployeePeriodCalculation;
  sortedIntervals: TimeActivityInterval[];
  shared: PeriodShared;
}): void {
  const { employee, policiesByDate, calculation, sortedIntervals } = input;
  const { findingPayload } = input.shared.payloads;
  const dailySourceMinutes = new Map<string, number>();
  const dailyBreakMinutes = new Map<string, number>();
  for (const bucket of calculation.activityBuckets) {
    dailySourceMinutes.set(
      bucket.localDate,
      (dailySourceMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
    );
    if (bucket.activityKind === 'break')
      dailyBreakMinutes.set(
        bucket.localDate,
        (dailyBreakMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
      );
  }
  const restMinutesByDate = new Map<string, number>();
  const workedIntervals = sortedIntervals.filter((interval) => interval.activityKind !== 'break');
  for (const [index, current] of workedIntervals.entries()) {
    const previous = workedIntervals[index - 1];
    if (!previous) continue;
    const previousDate = toBusinessIsoDate(new Date(previous.endedAt));
    const currentDate = toBusinessIsoDate(new Date(current.startedAt));
    if (previousDate === currentDate) continue;
    const restMinutes = Math.max(
      0,
      Math.floor((new Date(current.startedAt).getTime() - new Date(previous.endedAt).getTime()) / 60_000),
    );
    restMinutesByDate.set(currentDate, Math.min(restMinutesByDate.get(currentDate) ?? Infinity, restMinutes));
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
        if (policiesByDate.get(localDate)?.id !== effectivePolicy.id) return false;
        if (warning.warningKind === 'night_work')
          return calculation.supplementBuckets.some(
            (item) => item.localDate === localDate && item.supplementKind === 'night' && item.minutes > 0,
          );
        if (warning.warningKind === 'sunday_work')
          return calculation.supplementBuckets.some(
            (item) => item.localDate === localDate && item.supplementKind === 'sunday' && item.minutes > 0,
          );
        if (warning.warningKind === 'public_holiday_work')
          return calculation.supplementBuckets.some(
            (item) =>
              item.localDate === localDate && item.supplementKind === 'public_holiday' && item.minutes > 0,
          );
        if (warning.warningKind === 'daily_duration')
          return (dailySourceMinutes.get(localDate) ?? 0) > thresholdMinutes;
        if (warning.warningKind === 'break_duration')
          return (
            (dailySourceMinutes.get(localDate) ?? 0) - (dailyBreakMinutes.get(localDate) ?? 0) >
              BREAK_REQUIRED_ABOVE_MINUTES && (dailyBreakMinutes.get(localDate) ?? 0) < thresholdMinutes
          );
        if (warning.warningKind === 'rest_duration')
          return (restMinutesByDate.get(localDate) ?? Infinity) < thresholdMinutes;
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
      finding_kind: 'positive_overtime',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        overtime: calculation.overtimeCandidateMinutes,
      }),
      explanation: { minutes: calculation.overtimeCandidateMinutes },
    });
}

function pushEmployeeDailyResults(input: {
  employee: PeriodEmployee;
  employeeResultId: string;
  policiesByDate: PeriodPolicies;
  calculation: EmployeePeriodCalculation;
  intervals: TimeActivityInterval[];
  targetsByDate: Map<string, DailyTargetInput>;
  shared: PeriodShared;
}): void {
  const { employee, employeeResultId, policiesByDate, calculation, intervals, targetsByDate } = input;
  const { dailyPayload, sourcePayload } = input.shared.payloads;
  const { dates, dateBounds } = input.shared.index;
  const bucketsByDate = new Map<string, typeof calculation.activityBuckets>();
  for (const bucket of calculation.activityBuckets) {
    const list = bucketsByDate.get(bucket.localDate) ?? [];
    bucketsByDate.set(bucket.localDate, [...list, bucket]);
  }
  const supplementsByDate = new Map<string, typeof calculation.supplementBuckets>();
  for (const supplement of calculation.supplementBuckets) {
    const list = supplementsByDate.get(supplement.localDate) ?? [];
    supplementsByDate.set(supplement.localDate, [...list, supplement]);
  }
  const intervalBySourceId = new Map(intervals.map((interval) => [interval.sourceId, interval]));
  for (const date of dates) {
    const buckets = bucketsByDate.get(date) ?? [];
    const rows =
      buckets.length > 0
        ? buckets
        : [
            {
              activityKind: 'work' as const,
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
        target_minutes: index === 0 ? (targetsByDate.get(date)?.targetMinutes ?? 0) : 0,
        vacation_minutes: index === 0 ? (targetsByDate.get(date)?.vacationMinutes ?? 0) : 0,
        sickness_minutes: index === 0 ? (targetsByDate.get(date)?.sicknessMinutes ?? 0) : 0,
        night_minutes:
          index === 0 ? (supplements.find((item) => item.supplementKind === 'night')?.minutes ?? 0) : 0,
        sunday_minutes:
          index === 0 ? (supplements.find((item) => item.supplementKind === 'sunday')?.minutes ?? 0) : 0,
        public_holiday_minutes:
          index === 0
            ? (supplements.find((item) => item.supplementKind === 'public_holiday')?.minutes ?? 0)
            : 0,
      });
      for (const sourceId of bucket.sourceIds) {
        const sourceParts = sourceId.split(':');
        const sourceKind = sourceId.startsWith('segment:')
          ? 'time_segment'
          : sourceId.startsWith('correction:')
            ? 'correction_application'
            : 'legacy_entry';
        const sourceRecordId = sourceKind === 'correction_application' ? sourceParts[1] : sourceParts.at(-1);
        const interval = intervalBySourceId.get(sourceId);
        const { start: dayStart, end: dayEnd } = requirePresent(
          dateBounds.get(date),
          'period_date_out_of_range',
        );
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
            allocationKind: interval?.allocationKind ?? 'unallocated',
            jobId: interval?.jobId ?? null,
            jobNumber: interval?.jobNumber ?? '',
            projectId: interval?.projectId ?? null,
            projectNumber: interval?.projectNumber ?? '',
          },
        });
      }
    });
  }
}

function appendEmployeePeriodResults(
  employee: PeriodEmployee,
  policiesByEmployee: Map<string, PeriodPolicies>,
  shared: PeriodShared,
): void {
  const { bounds } = shared;
  const { dates, accountByEmployee } = shared.index;
  const { employeePayload } = shared.payloads;
  const policiesByDate = policiesByEmployee.get(employee.id) ?? new Map(dates.map((date) => [date, null]));
  const policy = policiesByDate.get(bounds.end) ?? null;
  const hasCompletePolicyHistory = dates.every((date) => policiesByDate.get(date) !== null);
  const employeeResultId = randomUUID();
  const accountCandidate = accountByEmployee.get(employee.id);
  const account = accountCandidate && accountCandidate.opened_on <= bounds.end ? accountCandidate : undefined;
  const intervals = buildEmployeeActivityIntervals(employee, shared);
  const { resolvedTargets, dailyTargets } = resolveEmployeeDailyTargets(employee, policiesByDate, shared);
  const calculation = calculateEmployeePeriodResult({
    employee,
    policy,
    account,
    hasCompletePolicyHistory,
    policiesByDate,
    intervals,
    resolvedTargets,
    dailyTargets,
    shared,
  });
  const targetsByDate = new Map(dailyTargets.map((target) => [target.localDate, target]));
  employeePayload.push({
    id: employeeResultId,
    employee_record_id: employee.id,
    policy_version_id: policy?.id ?? null,
    previous_balance_minutes: calculation.previousBalanceMinutes,
    target_minutes: calculation.targetMinutes,
    source_seconds: calculation.activityBuckets.reduce((sum, bucket) => sum + bucket.sourceSeconds, 0),
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
  const sortedIntervals = [...intervals].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  pushEmployeeIntegrityFindings({
    employee,
    policy,
    account,
    hasCompletePolicyHistory,
    policiesByDate,
    calculation,
    sortedIntervals,
    shared,
  });
  pushEmployeeReviewFindings({ employee, calculation, intervals, targetsByDate, shared });
  pushEmployeeWarningFindings({ employee, policiesByDate, calculation, sortedIntervals, shared });
  pushEmployeeDailyResults({
    employee,
    employeeResultId,
    policiesByDate,
    calculation,
    intervals,
    targetsByDate,
    shared,
  });
}

/**
 * Computes the rows prepare_time_period stores for one month. Throws the same
 * named errors as before the split (`period_source_incomplete`,
 * `period_segment_open`, `period_date_out_of_range`, `invalid_berlin_time`).
 */
export async function buildTimePeriodPreparation(input: {
  admin: SupabaseAdmin;
  context: { orgId: string };
  bounds: PeriodBounds;
  startInstant: string;
  endInstant: string;
}): Promise<TimePeriodPreparationPayload> {
  const { admin, context, bounds, startInstant, endInstant } = input;
  const sources = await loadPeriodSources(admin, context, bounds, startInstant, endInstant);
  const index = indexPeriodSources(sources, context, bounds, endInstant);
  const policiesByEmployee = await resolvePoliciesForPeriod(
    context.orgId,
    bounds.start,
    bounds.end,
    index.periodEmployees.map((employee) => employee.id),
  );
  const payloads: TimePeriodPreparationPayload = {
    employeePayload: [],
    dailyPayload: [],
    sourcePayload: [],
    findingPayload: [],
  };
  const shared: PeriodShared = { bounds, startInstant, endInstant, sources, index, payloads };
  for (const employee of index.periodEmployees) {
    appendEmployeePeriodResults(employee, policiesByEmployee, shared);
  }
  return payloads;
}
