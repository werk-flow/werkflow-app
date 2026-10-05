'use server';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import type { z } from '@/lib/zod';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  addLocalDays,
  addLocalMonthsClamped,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
} from './date-time';
import { preparePlanningCreation } from './creation';
import { materializeSeries } from './recurrence';
import {
  createPlanningEntrySchema,
  planningDateWindowSchema,
  planningIdSchema,
  planningOccurrenceStatusSchema,
  planningRescheduleScopeSchema,
  seriesHorizonApprovalSchema,
  updatePlanningCalendarSchema,
} from './schemas';
import {
  assessPlanningOccurrences,
  expandPlanningTeamsForDates,
  loadPlanningCalendarEntries,
  loadPlanningOptions,
} from './server';
import { rejectUnacknowledgedConflicts } from './conflict-acknowledgement';
import {
  planningOptionRequestSchema,
  type PlanningOptionRequest,
  type PlanningOptionResult,
} from './option-types';
import type {
  MaterializedOccurrence,
  PlanningActionFailure,
  PlanningActionResult,
  PlanningAssignmentDraft,
  PlanningCalendarEntry,
  PlanningSeriesDraft,
} from './types';
import { logError } from '@/lib/logging';

export async function getPlanningOptions(input: PlanningOptionRequest): Promise<PlanningOptionResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const parsed = planningOptionRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  if (parsed.data.organizationId !== auth.context.orgId)
    return { success: false, error: 'organization_changed' };
  return loadPlanningOptions(auth.context.orgId, parsed.data);
}

export async function getPlanningEntries(
  rawFrom: string,
  rawTo: string,
): Promise<ActionResult<{ entries: PlanningCalendarEntry[] }>> {
  const dateWindow = planningDateWindowSchema.safeParse({ from: rawFrom, to: rawTo });
  if (!dateWindow.success) return { success: false as const, error: 'invalid_input' };
  const { from, to } = dateWindow.data;
  try {
    if (
      addLocalDays(from, 0) !== from ||
      addLocalDays(to, 0) !== to ||
      from > to ||
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 366
    ) {
      return { success: false as const, error: 'invalid_input' };
    }
  } catch {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const entries = await loadPlanningCalendarEntries({
    orgId: auth.context.orgId,
    userId: auth.context.userId,
    isManager: auth.context.isManagerOrAbove,
    from,
    to,
  });
  return entries ? { success: true as const, entries } : { success: false as const, error: 'load_failed' };
}

export async function createPlanningEntry(rawInput: unknown): Promise<PlanningActionResult> {
  const parsed = createPlanningEntrySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const input = parsed.data;
  const prepared = await preparePlanningCreation(input, auth.context.orgId);
  if (!prepared.success) return prepared;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    'create_planning_entry_materialized',
    rpcArgs('create_planning_entry_materialized', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_series: prepared.series,
      p_occurrences: prepared.occurrences,
      p_assignments: prepared.assignments,
      p_idempotency_key: input.idempotencyKey,
      p_capacity_snapshot: prepared.capacitySnapshot,
      p_capacity_fingerprint: prepared.capacityFingerprint,
      p_qualification_snapshot: prepared.qualificationSnapshot,
      p_qualification_fingerprint: prepared.qualificationFingerprint,
      p_override_reason: input.overrideReason,
    }),
  );
  if (error) {
    logError('Failed to create planning entry', error);
    return { success: false, error: 'create_failed' };
  }
  return { success: true, occurrenceIds: (data ?? []) as string[] };
}

export async function extendPlanningSeriesHorizon(
  seriesId: string,
  rawApproval?: {
    assessmentFingerprint?: string | null;
    overrideReason?: string | null;
  },
): Promise<PlanningActionResult> {
  const parsedApproval = seriesHorizonApprovalSchema.safeParse(rawApproval);
  if (!planningIdSchema.safeParse(seriesId).success || !parsedApproval.success) {
    return { success: false, error: 'invalid_input' };
  }
  const approval = parsedApproval.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await admin
    .from('planning_series')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .eq('id', seriesId)
    .single();
  if (seriesError || !series) {
    return { success: false, error: 'series_not_found' };
  }
  if (!series.generated_through_local) {
    return { success: false, error: 'series_not_materialized' };
  }

  const { data: sourceOccurrence, error: sourceError } = await admin
    .from('planning_occurrences')
    .select('id')
    .eq('organization_id', auth.context.orgId)
    .eq('series_id', series.id)
    .eq('is_exception', false)
    .order('original_start_local', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceError || !sourceOccurrence) {
    return { success: false, error: 'series_not_materialized' };
  }
  const { data: sourceAssignments, error: assignmentError } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id, team_source_id')
    .eq('organization_id', auth.context.orgId)
    .eq('occurrence_id', sourceOccurrence.id);
  if (assignmentError) {
    logError('Failed to load series source assignments', assignmentError);
    return { success: false, error: 'load_failed' };
  }

  const draft: PlanningSeriesDraft = {
    entryKind: series.entry_kind,
    internalType: series.internal_type,
    jobId: series.job_id,
    title: series.title,
    description: series.description,
    location: series.location,
    timeKind: series.time_kind,
    startsAtLocal: series.starts_at_local,
    durationMinutes: series.duration_minutes,
    durationDays: series.duration_days,
    timezone: 'Europe/Berlin',
    frequency: series.recurrence_frequency as PlanningSeriesDraft['frequency'],
    interval: series.recurrence_interval,
    weekdays: series.weekdays,
    monthDay: series.month_day,
    occurrenceCount: series.occurrence_count,
    untilLocalDate: series.until_local_date,
  };
  const currentGeneratedThrough = series.generated_through_local;
  const horizon = addLocalMonthsClamped(currentGeneratedThrough.slice(0, 10), 6);
  const occurrences = materializeSeries(draft, horizon).filter(
    (occurrence) =>
      occurrence.originalStartLocal > currentGeneratedThrough &&
      occurrence.originalStartLocal >= series.segment_start_local &&
      (!series.segment_end_before_local || occurrence.originalStartLocal < series.segment_end_before_local),
  );
  if (occurrences.length === 0) {
    return { success: true, occurrenceIds: [] };
  }

  const teamIds = [
    ...new Set(
      (sourceAssignments ?? []).flatMap((assignment) =>
        assignment.team_source_id ? [assignment.team_source_id] : [],
      ),
    ),
  ];
  const directAssignments: PlanningAssignmentDraft[] = (sourceAssignments ?? [])
    .filter((assignment) => !assignment.team_source_id)
    .map((assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: null,
    }));
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin,
    orgId: auth.context.orgId,
    teamIds,
    localDates: occurrences.map((occurrence) => occurrence.originalStartLocal.slice(0, 10)),
  });
  if (!teamAssignmentsByDate) {
    return { success: false, error: 'team_load_failed' };
  }
  const assignmentsByOriginalStartLocal = new Map<string, PlanningAssignmentDraft[]>();
  const assignments = occurrences.flatMap((occurrence) => {
    const occurrenceAssignments = [
      ...new Map(
        [
          ...directAssignments,
          ...(teamAssignmentsByDate.get(occurrence.originalStartLocal.slice(0, 10)) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment]),
      ).values(),
    ];
    assignmentsByOriginalStartLocal.set(occurrence.originalStartLocal, occurrenceAssignments);
    return occurrenceAssignments.map((assignment) => ({
      ...assignment,
      occurrenceOriginalStartLocal: occurrence.originalStartLocal,
    }));
  });
  const assessment = await assessPlanningOccurrences({
    orgId: auth.context.orgId,
    jobId: series.job_id,
    occurrences,
    assignments: [],
    assignmentsByOriginalStartLocal,
  });
  if (!assessment) return { success: false, error: 'assessment_failed' };
  const conflictRejection = rejectUnacknowledgedConflicts(assessment, {
    overrideReason: approval?.overrideReason ?? null,
    assessmentFingerprint: approval?.assessmentFingerprint ?? null,
  });
  if (conflictRejection) return conflictRejection;

  const { data, error } = await admin.rpc(
    'extend_planning_series_materialization',
    rpcArgs('extend_planning_series_materialization', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_series_id: series.id,
      p_expected_generated_through_local: series.generated_through_local,
      p_occurrences: occurrences,
      p_assignments: assignments,
      p_capacity_snapshot: assessment.capacitySnapshot,
      p_capacity_fingerprint: assessment.capacityFingerprint,
      p_qualification_snapshot: assessment.qualificationSnapshot,
      p_qualification_fingerprint: assessment.qualificationFingerprint,
      p_override_reason: approval?.overrideReason ?? null,
    }),
  );
  if (error) {
    logError('Failed to extend planning series horizon', error);
    return {
      success: false,
      error: error.message.includes('stale_planning_series') ? 'stale_series' : 'extension_failed',
    };
  }
  return { success: true, occurrenceIds: (data ?? []) as string[] };
}

export type UpdatePlanningCalendarInput = {
  plannedDate?: string;
  plannedTime?: string;
  estimatedDurationMinutes?: number | null;
  durationDays?: number;
  selectedUserIds?: string[];
  selectedEmployeeRecordIds?: string[];
  overrideReason?: string | null;
  assessmentFingerprint?: string | null;
};

export async function updatePlanningCalendarEntry(
  occurrenceId: string,
  rawInput: UpdatePlanningCalendarInput,
): Promise<{ success: true; version: number } | PlanningActionFailure> {
  const parsed = updatePlanningCalendarSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  if (!planningIdSchema.safeParse(occurrenceId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const admin = createSupabaseAdminClient();
  const { data: occurrence, error } = await admin
    .from('planning_occurrences')
    .select(
      'id, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local, version',
    )
    .eq('id', occurrenceId)
    .eq('organization_id', auth.context.orgId)
    .single();
  if (error || !occurrence) {
    return { success: false as const, error: 'not_found' };
  }
  const { data: currentAssignments, error: assignmentError } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id, team_source_id')
    .eq('organization_id', auth.context.orgId)
    .eq('occurrence_id', occurrenceId);
  if (assignmentError) {
    logError('Failed to load occurrence assignments', assignmentError);
    return { success: false as const, error: 'load_failed' };
  }

  let assignments: PlanningAssignmentDraft[] = (currentAssignments ?? []).map((assignment) => ({
    employeeRecordId: assignment.employee_record_id,
    teamSourceId: assignment.team_source_id,
  }));
  const selection = await resolveSelectedPlanningAssignments(admin, auth.context.orgId, input);
  if (!selection.success) return selection;
  if (selection.assignments) assignments = selection.assignments;

  let materialized: MaterializedOccurrence;
  if (occurrence.time_kind === 'timed') {
    if (!occurrence.start_at || !occurrence.end_at) {
      return { success: false as const, error: 'invalid_occurrence' };
    }
    const currentLocal = formatBerlinLocalDateTime(occurrence.start_at);
    const date = input.plannedDate ?? currentLocal.slice(0, 10);
    const time = input.plannedTime ?? currentLocal.slice(11, 16);
    const resolved = resolveBerlinWallTime(`${date}T${time}`);
    if (!resolved) return { success: false as const, error: 'invalid_input' };
    const durationMinutes =
      input.estimatedDurationMinutes ??
      Math.round((new Date(occurrence.end_at).getTime() - new Date(occurrence.start_at).getTime()) / 60_000);
    materialized = {
      originalStartLocal: occurrence.original_start_local ?? `${date}T${time}`,
      timeKind: 'timed',
      startAt: resolved.instant.toISOString(),
      endAt: new Date(resolved.instant.getTime() + durationMinutes * 60_000).toISOString(),
      startDate: null,
      endDateExclusive: null,
      dstResolution: resolved.resolution,
    };
  } else {
    if (!occurrence.start_date || !occurrence.end_date_exclusive) {
      return { success: false as const, error: 'invalid_occurrence' };
    }
    const durationDays =
      input.durationDays ??
      Math.round(
        (new Date(`${occurrence.end_date_exclusive}T00:00:00Z`).getTime() -
          new Date(`${occurrence.start_date}T00:00:00Z`).getTime()) /
          86_400_000,
      );
    const startDate = input.plannedDate ?? occurrence.start_date;
    materialized = {
      originalStartLocal: occurrence.original_start_local ?? `${startDate}T00:00`,
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate,
      endDateExclusive: new Date(new Date(`${startDate}T00:00:00Z`).getTime() + durationDays * 86_400_000)
        .toISOString()
        .slice(0, 10),
      dstResolution: 'exact',
    };
  }
  const assessment = await assessPlanningOccurrences({
    orgId: auth.context.orgId,
    jobId: occurrence.job_id,
    occurrences: [materialized],
    assignments,
    excludeOccurrenceId: occurrenceId,
  });
  if (!assessment) return { success: false as const, error: 'assessment_failed' };
  const conflictRejection = rejectUnacknowledgedConflicts(assessment, {
    overrideReason: input.overrideReason ?? null,
    assessmentFingerprint: input.assessmentFingerprint ?? null,
  });
  if (conflictRejection) return conflictRejection;
  const { data: version, error: updateError } = await admin.rpc(
    'update_planning_occurrence',
    rpcArgs('update_planning_occurrence', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_occurrence_id: occurrenceId,
      p_expected_version: occurrence.version,
      p_occurrence: materialized,
      p_assignments: assignments,
      p_capacity_snapshot: assessment.capacitySnapshot,
      p_capacity_fingerprint: assessment.capacityFingerprint,
      p_qualification_snapshot: assessment.qualificationSnapshot,
      p_qualification_fingerprint: assessment.qualificationFingerprint,
      p_override_reason: input.overrideReason ?? null,
    }),
  );
  if (updateError) {
    logError('Failed to update planning occurrence', updateError);
    return {
      success: false as const,
      error: updateError.message.includes('stale_planning_occurrence')
        ? 'stale_occurrence'
        : updateError.message.includes('started_planning_occurrence_immutable')
          ? 'started_occurrence'
          : 'update_failed',
    };
  }
  return { success: true as const, version: version as number };
}

type ParsedPlanningCalendarInput = z.infer<typeof updatePlanningCalendarSchema>;

/**
 * The direct assignments an edit selects, by employee record or by member user id, checked against
 * the organization. `assignments` is null when the edit keeps the current assignments.
 */
async function resolveSelectedPlanningAssignments(
  admin: AdminClient,
  orgId: string,
  request: ParsedPlanningCalendarInput,
): Promise<ActionResult<{ assignments: PlanningAssignmentDraft[] | null }>> {
  if (request.selectedEmployeeRecordIds) {
    const recordIds = [...new Set(request.selectedEmployeeRecordIds)];
    const { data: records, error: recordsError } = await readInBatches(recordIds, (batch) =>
      admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    );
    if (recordsError) logError('Failed to load selected employee records', recordsError);
    if (recordsError || records.length !== recordIds.length) {
      return { success: false as const, error: 'employee_not_found' };
    }
    return {
      success: true as const,
      assignments: recordIds.map((employeeRecordId) => ({ employeeRecordId, teamSourceId: null })),
    };
  }
  if (request.selectedUserIds) {
    const userIds = [...new Set(request.selectedUserIds)];
    const { data: records, error: recordsError } = await readInBatches(userIds, (batch) =>
      admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .in('user_id', [...batch]),
    );
    if (recordsError) logError('Failed to load selected member records', recordsError);
    if (recordsError || records.length !== userIds.length) {
      return { success: false as const, error: 'member_not_found' };
    }
    return {
      success: true as const,
      assignments: records.map((record) => ({ employeeRecordId: record.id, teamSourceId: null })),
    };
  }
  return { success: true as const, assignments: null };
}

type RescheduleSelectedOccurrence = Pick<
  Database['public']['Tables']['planning_occurrences']['Row'],
  'start_at' | 'end_at' | 'start_date' | 'end_date_exclusive'
>;

function buildRescheduledSeriesDraft(input: {
  series: Database['public']['Tables']['planning_series']['Row'];
  selected: RescheduleSelectedOccurrence;
  request: ParsedPlanningCalendarInput;
  startsAtLocal: string;
  remainingOccurrenceCount: number | null;
}): PlanningSeriesDraft {
  const { series, selected, startsAtLocal, remainingOccurrenceCount } = input;
  const existingDurationMinutes =
    selected.start_at && selected.end_at
      ? Math.round((new Date(selected.end_at).getTime() - new Date(selected.start_at).getTime()) / 60_000)
      : null;
  const existingDurationDays =
    selected.start_date && selected.end_date_exclusive
      ? Math.round(
          (new Date(`${selected.end_date_exclusive}T00:00:00Z`).getTime() -
            new Date(`${selected.start_date}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      : null;
  return {
    entryKind: series.entry_kind,
    internalType: series.internal_type,
    jobId: series.job_id,
    title: series.title,
    description: series.description,
    location: series.location,
    timeKind: series.time_kind,
    startsAtLocal,
    durationMinutes:
      series.time_kind === 'timed'
        ? (input.request.estimatedDurationMinutes ?? existingDurationMinutes ?? series.duration_minutes)
        : null,
    durationDays:
      series.time_kind === 'all_day'
        ? (input.request.durationDays ?? existingDurationDays ?? series.duration_days)
        : null,
    timezone: 'Europe/Berlin',
    frequency: series.recurrence_frequency as PlanningSeriesDraft['frequency'],
    interval: series.recurrence_interval,
    weekdays: series.weekdays,
    monthDay: series.month_day,
    occurrenceCount: remainingOccurrenceCount,
    untilLocalDate: series.until_local_date,
  };
}

async function resolveSeriesRescheduleAssignments(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceId: string;
  request: ParsedPlanningCalendarInput;
  generated: MaterializedOccurrence[];
}): Promise<ActionResult<{ assignmentsByOriginalStartLocal: Map<string, PlanningAssignmentDraft[]> }>> {
  const { admin, generated } = input;
  const { data: assignmentRows, error: assignmentsError } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id, team_source_id')
    .eq('organization_id', input.orgId)
    .eq('occurrence_id', input.occurrenceId);
  if (assignmentsError) {
    logError('Failed to load occurrence assignments', assignmentsError);
    return { success: false as const, error: 'load_failed' };
  }
  let teamIds = [
    ...new Set(
      (assignmentRows ?? []).flatMap((assignment) =>
        assignment.team_source_id ? [assignment.team_source_id] : [],
      ),
    ),
  ];
  let directAssignments: PlanningAssignmentDraft[] = (assignmentRows ?? [])
    .filter((assignment) => !assignment.team_source_id)
    .map((assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: null,
    }));
  const selection = await resolveSelectedPlanningAssignments(admin, input.orgId, input.request);
  if (!selection.success) return selection;
  if (selection.assignments) {
    directAssignments = selection.assignments;
    teamIds = [];
  }
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin,
    orgId: input.orgId,
    teamIds,
    localDates: generated.map((occurrence) => occurrence.originalStartLocal.slice(0, 10)),
  });
  if (!teamAssignmentsByDate) {
    return { success: false as const, error: 'team_load_failed' };
  }
  const assignmentsByOriginalStartLocal = new Map<string, PlanningAssignmentDraft[]>();
  for (const occurrence of generated) {
    assignmentsByOriginalStartLocal.set(occurrence.originalStartLocal, [
      ...new Map(
        [
          ...directAssignments,
          ...(teamAssignmentsByDate.get(occurrence.originalStartLocal.slice(0, 10)) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment]),
      ).values(),
    ]);
  }
  return { success: true, assignmentsByOriginalStartLocal };
}

export async function reschedulePlanningSeries(
  occurrenceId: string,
  rawScope: 'future' | 'series',
  rawInput: UpdatePlanningCalendarInput,
): Promise<PlanningActionResult> {
  const parsed = updatePlanningCalendarSchema.safeParse(rawInput);
  const parsedScope = planningRescheduleScopeSchema.safeParse(rawScope);
  if (!parsed.success || !parsedScope.success || !planningIdSchema.safeParse(occurrenceId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const input = parsed.data;
  const scope = parsedScope.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: selected, error: selectedError } = await admin
    .from('planning_occurrences')
    .select(
      'id, series_id, series_lineage_id, original_start_local, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, version',
    )
    .eq('organization_id', auth.context.orgId)
    .eq('id', occurrenceId)
    .single();
  if (
    selectedError ||
    !selected?.series_id ||
    !selected.series_lineage_id ||
    !selected.original_start_local
  ) {
    return { success: false as const, error: 'series_not_found' };
  }
  if (!selected.start_at && !selected.start_date) {
    return { success: false as const, error: 'invalid_occurrence' };
  }
  const { data: series, error: seriesError } = await admin
    .from('planning_series')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .eq('id', selected.series_id)
    .single();
  if (seriesError || !series) {
    return { success: false as const, error: 'series_not_found' };
  }
  const seriesLineageId = selected.series_lineage_id;
  const selectedOriginalStartLocal = selected.original_start_local;
  const { data: lineageOccurrences, error: lineageError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_occurrences')
        .select('id, series_id, original_start_local, start_at, start_date, status, is_exception')
        .eq('organization_id', auth.context.orgId)
        .eq('series_lineage_id', seriesLineageId)
        .not('original_start_local', 'is', null)
        .order('original_start_local', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (lineageError) {
    logError('Failed to load the series lineage', lineageError);
    return { success: false as const, error: 'load_failed' };
  }
  const now = Date.now();
  const today = getBusinessTodayIso();
  const mutable = (lineageOccurrences ?? []).filter((occurrence) => {
    if (!occurrence.original_start_local || occurrence.is_exception) return false;
    if (scope === 'future' && occurrence.original_start_local < selectedOriginalStartLocal) {
      return false;
    }
    return occurrence.start_at
      ? new Date(occurrence.start_at).getTime() > now
      : Boolean(occurrence.start_date && occurrence.start_date > today);
  });
  if (mutable.length === 0) {
    return { success: false as const, error: 'no_mutable_occurrences' };
  }
  const identityOriginals = mutable.flatMap((occurrence) =>
    occurrence.original_start_local ? [occurrence.original_start_local] : [],
  );
  const selectedCurrentLocal = selected.start_at
    ? formatBerlinLocalDateTime(selected.start_at)
    : `${selected.start_date}T00:00`;
  const requestedDate = input.plannedDate ?? selectedCurrentLocal.slice(0, 10);
  const requestedTime =
    selected.time_kind === 'timed' ? (input.plannedTime ?? selectedCurrentLocal.slice(11, 16)) : '00:00';
  const dayShift = Math.round(
    (new Date(`${requestedDate}T00:00:00Z`).getTime() -
      new Date(`${selectedCurrentLocal.slice(0, 10)}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  const boundaryOriginal = identityOriginals[0];
  if (boundaryOriginal === undefined) {
    return { success: false as const, error: 'no_mutable_occurrences' };
  }
  const positionsBeforeBoundary = (lineageOccurrences ?? []).filter(
    (occurrence) => occurrence.original_start_local && occurrence.original_start_local < boundaryOriginal,
  ).length;
  const remainingOccurrenceCount = series.occurrence_count
    ? Math.max(identityOriginals.length, series.occurrence_count - positionsBeforeBoundary)
    : null;
  const startsAtLocal = `${addLocalDays(boundaryOriginal.slice(0, 10), dayShift)}T${requestedTime}`;
  const draft = buildRescheduledSeriesDraft({
    series,
    selected,
    request: input,
    startsAtLocal,
    remainingOccurrenceCount,
  });
  const horizon = addLocalMonthsClamped(startsAtLocal.slice(0, 10), 18);
  const generated = materializeSeries(draft, horizon).slice(0, identityOriginals.length);
  if (generated.length !== identityOriginals.length) {
    return { success: false as const, error: 'invalid_recurrence' };
  }
  const assignmentResolution = await resolveSeriesRescheduleAssignments({
    admin,
    orgId: auth.context.orgId,
    occurrenceId,
    request: input,
    generated,
  });
  if (!assignmentResolution.success) return assignmentResolution;
  const { assignmentsByOriginalStartLocal } = assignmentResolution;
  const assessment = await assessPlanningOccurrences({
    orgId: auth.context.orgId,
    jobId: selected.job_id,
    occurrences: generated,
    assignments: [],
    assignmentsByOriginalStartLocal,
    excludeOccurrenceIds: mutable.map((occurrence) => occurrence.id),
  });
  if (!assessment) return { success: false as const, error: 'assessment_failed' };
  const conflictRejection = rejectUnacknowledgedConflicts(assessment, {
    overrideReason: input.overrideReason ?? null,
    assessmentFingerprint: input.assessmentFingerprint ?? null,
  });
  if (conflictRejection) return conflictRejection;
  const occurrencePayload = generated.map((occurrence, index) => ({
    ...occurrence,
    identityOriginalStartLocal: identityOriginals[index] ?? occurrence.originalStartLocal,
  }));
  const assignmentPayload = occurrencePayload.flatMap((occurrence) =>
    (assignmentsByOriginalStartLocal.get(occurrence.originalStartLocal) ?? []).map((assignment) => ({
      ...assignment,
      occurrenceOriginalStartLocal: occurrence.identityOriginalStartLocal,
    })),
  );
  const { data, error } = await admin.rpc(
    'reschedule_planning_series',
    rpcArgs('reschedule_planning_series', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_occurrence_id: occurrenceId,
      p_expected_version: selected.version,
      p_scope: scope,
      p_series: {
        ...draft,
        generatedThroughLocal: occurrencePayload.at(-1)?.identityOriginalStartLocal ?? null,
      },
      p_occurrences: occurrencePayload,
      p_assignments: assignmentPayload,
      p_capacity_snapshot: assessment.capacitySnapshot,
      p_capacity_fingerprint: assessment.capacityFingerprint,
      p_qualification_snapshot: assessment.qualificationSnapshot,
      p_qualification_fingerprint: assessment.qualificationFingerprint,
      p_override_reason: input.overrideReason ?? null,
    }),
  );
  if (error) {
    logError('Failed to reschedule planning series', error);
    return { success: false as const, error: 'update_failed' };
  }
  return { success: true as const, occurrenceIds: (data ?? []) as string[] };
}

export async function setPlanningOccurrenceStatus(
  occurrenceId: string,
  status: 'skipped' | 'cancelled',
  reason: string,
): Promise<ActionResult<{ version: number }>> {
  const parsed = planningOccurrenceStatusSchema.safeParse({
    occurrenceId,
    status,
    reason,
  });
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: occurrence, error } = await admin
    .from('planning_occurrences')
    .select('version')
    .eq('organization_id', auth.context.orgId)
    .eq('id', occurrenceId)
    .single();
  if (error || !occurrence) return { success: false as const, error: 'not_found' };
  const { data: version, error: updateError } = await admin.rpc('set_planning_occurrence_status', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_occurrence_id: occurrenceId,
    p_expected_version: occurrence.version,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (updateError) {
    logError('Failed to change planning occurrence status', updateError);
    return { success: false as const, error: 'update_failed' };
  }
  return { success: true as const, version: version as number };
}
