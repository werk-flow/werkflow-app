import 'server-only';

// P1-23 period sources: the bounded reads of every period source, their index
// per employee, and the shapes the period preparation passes between its
// steps. The source reads, their grouping, and the row order are the
// payroll-relevant contract; change them only together with prepareTimePeriod.

import { createHash } from 'node:crypto';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { addLocalDays, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import { projectLegacyEntriesForWindow } from '@/lib/time-accounts/legacy-projection';
import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionSource,
} from '@/lib/time-corrections/types';
import { TIME_ENTRY_TYPES, type TimeEntry, type TimeEntryRow } from '@/lib/time-tracking/types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import type { TimeAccountPolicy } from './types';

export type PeriodBounds = { start: string; end: string; endExclusive: string };

export type TimePeriodPreparationPayload = {
  employeePayload: Array<Record<string, unknown>>;
  dailyPayload: Array<Record<string, unknown>>;
  sourcePayload: Array<Record<string, unknown>>;
  findingPayload: Array<Record<string, unknown>>;
};

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

export function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

export function getBerlinInstant(localDateTime: string): string {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error('invalid_berlin_time');
  return resolved.instant.toISOString();
}

function toLegacyEntries(rows: readonly TimeEntryRow[]): TimeEntry[] {
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    entryType: constrainedValue(TIME_ENTRY_TYPES, row.entry_type, 'time_entries.entry_type'),
    timestamp: row.timestamp,
    isManual: row.is_manual,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    jobId: row.job_id,
  }));
}

// Time and account sources; started in the same order as before the split so
// the combined Promise.all below keeps one read group.
function startPeriodActivityReads(
  admin: AdminClient,
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

// Schedules, conditions and the job and project numbers; the reads that follow
// the activity reads in the combined Promise.all.
function startPeriodPlanReads(admin: AdminClient, context: { orgId: string }, bounds: PeriodBounds) {
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
  ] as const;
}

// Correction applications and requests; the last reads of the database group.
function startPeriodCorrectionReads(admin: AdminClient, context: { orgId: string }) {
  return [
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
  admin: AdminClient,
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
    ...startPeriodPlanReads(admin, context, bounds),
    ...startPeriodCorrectionReads(admin, context),
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

export type PeriodSources = Awaited<ReturnType<typeof loadPeriodSources>>;
export type PeriodEmployee = PeriodSources['employees'][number];

function groupAccountEventsByEmployee(
  accountEvents: PeriodSources['accountEvents'],
): Map<string, PeriodSources['accountEvents']> {
  const eventsByEmployee = new Map<string, typeof accountEvents>();
  for (const event of accountEvents ?? []) {
    const list = eventsByEmployee.get(event.employee_record_id) ?? [];
    list.push(event);
    eventsByEmployee.set(event.employee_record_id, list);
  }
  return eventsByEmployee;
}

function projectApprovedCorrectionApplications(
  sources: PeriodSources,
): TimeCorrectionApplicationProjection[] {
  const { correctionSources, correctionApplications } = sources;
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
  return (correctionApplications ?? []).flatMap((application) => {
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
}

function groupEffectiveLegacyEntriesByUser(input: {
  legacyRows: PeriodSources['legacyRows'];
  approvedCorrectionApplications: TimeCorrectionApplicationProjection[];
  context: { orgId: string };
  bounds: PeriodBounds;
  endInstant: string;
}): Map<string, TimeEntry[]> {
  const { legacyRows, approvedCorrectionApplications, context, bounds, endInstant } = input;
  const effectiveEntries = projectLegacyEntriesForWindow({
    entries: toLegacyEntries(legacyRows ?? []),
    applications: approvedCorrectionApplications,
    organizationId: context.orgId,
    startInstant: getBerlinInstant(`${addLocalDays(bounds.start, -1)}T00:00`),
    endInstant,
  });
  const legacyByUser = new Map<string, TimeEntry[]>();
  for (const entry of effectiveEntries) {
    const list = legacyByUser.get(entry.userId) ?? [];
    list.push(entry);
    legacyByUser.set(entry.userId, list);
  }
  return legacyByUser;
}

function indexPeriodSources(
  sources: PeriodSources,
  context: { orgId: string },
  bounds: PeriodBounds,
  endInstant: string,
) {
  const { accounts, accountEvents, legacyRows } = sources;
  const { employees, projects, jobs } = sources;
  const accountByEmployee = new Map((accounts ?? []).map((account) => [account.employee_record_id, account]));
  const eventsByEmployee = groupAccountEventsByEmployee(accountEvents);
  const approvedCorrectionApplications = projectApprovedCorrectionApplications(sources);
  const suppressedSegmentIds = new Set(
    approvedCorrectionApplications.flatMap((application) =>
      application.sources.flatMap((source) => (source.kind === 'canonical_segment' ? [source.id] : [])),
    ),
  );
  const legacyByUser = groupEffectiveLegacyEntriesByUser({
    legacyRows,
    approvedCorrectionApplications,
    context,
    bounds,
    endInstant,
  });
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
export type PeriodPolicies = Map<string, TimeAccountPolicy | null>;
export type PeriodShared = {
  bounds: PeriodBounds;
  startInstant: string;
  endInstant: string;
  sources: PeriodSources;
  index: PeriodIndex;
  payloads: TimePeriodPreparationPayload;
};

/** Reads every period source, then indexes it per employee and date. */
export async function loadIndexedPeriodSources(input: {
  admin: AdminClient;
  context: { orgId: string };
  bounds: PeriodBounds;
  startInstant: string;
  endInstant: string;
}): Promise<{ sources: PeriodSources; index: PeriodIndex }> {
  const { admin, context, bounds, startInstant, endInstant } = input;
  const sources = await loadPeriodSources(admin, context, bounds, startInstant, endInstant);
  const index = indexPeriodSources(sources, context, bounds, endInstant);
  return { sources, index };
}
