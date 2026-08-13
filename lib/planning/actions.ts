'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  addLocalDays,
  addLocalMonthsClamped,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
} from './date-time';
import { materializeSeries } from './recurrence';
import {
  createPlanningEntrySchema,
  planningIdSchema,
  planningOccurrenceStatusSchema,
  updatePlanningCalendarSchema,
  type CreatePlanningEntryInput,
} from './schemas';
import {
  assessPlanningOccurrences,
  expandPlanningTeamsForDates,
  loadPlanningCalendarEntries,
  loadPlanningOptions,
} from './server';
import type {
  MaterializedOccurrence,
  PlanningActionResult,
  PlanningAssignmentDraft,
  PlanningSeriesDraft,
} from './types';

function revalidatePlanningMutation(organizationId: string): void {
  revalidatePath('/kalender');
  updateTag(CACHE_TAGS.jobs(organizationId));
  updateTag(CACHE_TAGS.projects(organizationId));
}

function logPlanningRpcFailure(
  operation: string,
  error: { code?: string } | null
): void {
  console.error(operation, { code: error?.code ?? 'unknown' });
}

export async function getPlanningOptions() {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const options = await loadPlanningOptions(auth.context.orgId);
  return options
    ? { success: true as const, ...options }
    : { success: false as const, error: 'load_failed' };
}

export async function getPlanningEntries(from: string, to: string) {
  try {
    if (
      addLocalDays(from, 0) !== from ||
      addLocalDays(to, 0) !== to ||
      from > to ||
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 >
        366
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
  return entries
    ? { success: true as const, entries }
    : { success: false as const, error: 'load_failed' };
}

function buildSeriesDraft(input: CreatePlanningEntryInput): PlanningSeriesDraft {
  const recurrence = input.recurrence ?? {
    frequency: 'daily' as const,
    interval: 1,
    weekdays: null,
    monthDay: null,
    occurrenceCount: 1,
    untilLocalDate: null,
  };
  return {
    entryKind: input.entryKind,
    internalType: input.internalType,
    jobId: input.jobId,
    title: input.title,
    description: input.description,
    location: input.location,
    timeKind: input.timeKind,
    startsAtLocal: input.startsAtLocal,
    durationMinutes: input.durationMinutes,
    durationDays: input.durationDays,
    timezone: 'Europe/Berlin',
    ...recurrence,
  };
}

function serializeOccurrence(
  occurrence: MaterializedOccurrence,
  input: CreatePlanningEntryInput
) {
  return {
    ...occurrence,
    jobId: input.jobId,
    entryKind: input.entryKind,
    internalType: input.internalType,
    title: input.title,
    description: input.description,
    location: input.location,
  };
}

async function preparePlanningEntry(
  input: CreatePlanningEntryInput,
  organizationId: string
) {
  const admin = createSupabaseAdminClient();
  const draft = buildSeriesDraft(input);
  const horizon = addLocalMonthsClamped(input.startsAtLocal.slice(0, 10), 18);
  const occurrences = materializeSeries(draft, horizon);
  const assignments: Array<
    PlanningAssignmentDraft & { occurrenceOriginalStartLocal: string }
  > = [];
  const assignmentsByOriginalStartLocal = new Map<
    string,
    PlanningAssignmentDraft[]
  >();
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin,
    orgId: organizationId,
    teamIds: [...new Set(input.teamIds)],
    localDates: occurrences.map((occurrence) =>
      occurrence.originalStartLocal.slice(0, 10)
    ),
  });
  if (!teamAssignmentsByDate) {
    return { success: false as const, error: 'team_load_failed' };
  }
  for (const occurrence of occurrences) {
    const occurrenceAssignments: PlanningAssignmentDraft[] = [
      ...new Map(
        [
          ...input.assignmentDrafts,
          ...(teamAssignmentsByDate.get(
            occurrence.originalStartLocal.slice(0, 10)
          ) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment])
      ).values(),
    ];
    assignments.push(
      ...occurrenceAssignments.map((assignment) => ({
        ...assignment,
        occurrenceOriginalStartLocal: occurrence.originalStartLocal,
      }))
    );
    assignmentsByOriginalStartLocal.set(
      occurrence.originalStartLocal,
      occurrenceAssignments
    );
  }
  const assessment = await assessPlanningOccurrences({
    orgId: organizationId,
    jobId: input.jobId,
    occurrences,
    assignments: [],
    assignmentsByOriginalStartLocal,
  });
  if (!assessment) {
    return { success: false as const, error: 'assessment_failed' };
  }
  return {
    success: true as const,
    draft,
    occurrences,
    assignments,
    ...assessment,
  };
}

export async function previewPlanningEntry(rawInput: unknown) {
  const parsed = createPlanningEntrySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const prepared = await preparePlanningEntry(parsed.data, auth.context.orgId);
  if (!prepared.success) return prepared;
  return {
    success: true as const,
    occurrenceCount: prepared.occurrences.length,
    assignments: prepared.assignments,
    conflicts: prepared.conflicts,
    assessmentFingerprint: prepared.assessmentFingerprint,
    capacitySnapshot: prepared.capacitySnapshot,
    capacityFingerprint: prepared.capacityFingerprint,
    qualificationSnapshot: prepared.qualificationSnapshot,
    qualificationFingerprint: prepared.qualificationFingerprint,
  };
}

export async function createPlanningEntry(
  rawInput: unknown
): Promise<PlanningActionResult> {
  const parsed = createPlanningEntrySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const input = parsed.data;
  const prepared = await preparePlanningEntry(input, auth.context.orgId);
  if (!prepared.success) return prepared;
  if (prepared.conflicts.length > 0) {
    if (!input.overrideReason) {
      return {
        success: false,
        error: 'planning_warning',
        conflicts: prepared.conflicts,
        fingerprint: prepared.assessmentFingerprint,
      };
    }
    if (input.assessmentFingerprint !== prepared.assessmentFingerprint) {
      return {
        success: false,
        error: 'stale_assessment',
        conflicts: prepared.conflicts,
        fingerprint: prepared.assessmentFingerprint,
      };
    }
  }

  const { draft, occurrences } = prepared;
  const generatedThroughLocal = occurrences.at(-1)?.originalStartLocal ?? null;
  const series = input.recurrence
    ? {
        ...draft,
        segmentStartLocal: input.startsAtLocal,
        segmentEndBeforeLocal: null,
        generatedThroughLocal,
      }
    : null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('create_planning_entry_materialized', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_series: series,
    p_occurrences: occurrences.map((occurrence) =>
      serializeOccurrence(occurrence, input)
    ),
    p_assignments: prepared.assignments,
    p_idempotency_key: input.idempotencyKey,
    p_capacity_snapshot: prepared.capacitySnapshot,
    p_capacity_fingerprint: prepared.capacityFingerprint,
    p_qualification_snapshot: prepared.qualificationSnapshot,
    p_qualification_fingerprint: prepared.qualificationFingerprint,
    p_override_reason: input.overrideReason,
  });
  if (error) {
    logPlanningRpcFailure('Failed to create planning entry', error);
    return { success: false, error: 'create_failed' };
  }
  revalidatePlanningMutation(auth.context.orgId);
  return { success: true, occurrenceIds: (data ?? []) as string[] };
}

export async function extendPlanningSeriesHorizon(
  seriesId: string,
  approval?: {
    assessmentFingerprint?: string | null;
    overrideReason?: string | null;
  }
): Promise<PlanningActionResult> {
  if (!planningIdSchema.safeParse(seriesId).success) {
    return { success: false, error: 'invalid_input' };
  }
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
  if (assignmentError) return { success: false, error: 'load_failed' };

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
  const horizon = addLocalMonthsClamped(
    currentGeneratedThrough.slice(0, 10),
    6
  );
  const occurrences = materializeSeries(draft, horizon).filter(
    (occurrence) =>
      occurrence.originalStartLocal > currentGeneratedThrough &&
      occurrence.originalStartLocal >= series.segment_start_local &&
      (!series.segment_end_before_local ||
        occurrence.originalStartLocal < series.segment_end_before_local)
  );
  if (occurrences.length === 0) {
    return { success: true, occurrenceIds: [] };
  }

  const teamIds = [
    ...new Set(
      (sourceAssignments ?? []).flatMap((assignment) =>
        assignment.team_source_id ? [assignment.team_source_id] : []
      )
    ),
  ];
  const directAssignments: PlanningAssignmentDraft[] = (
    sourceAssignments ?? []
  )
    .filter((assignment) => !assignment.team_source_id)
    .map((assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: null,
    }));
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin,
    orgId: auth.context.orgId,
    teamIds,
    localDates: occurrences.map((occurrence) =>
      occurrence.originalStartLocal.slice(0, 10)
    ),
  });
  if (!teamAssignmentsByDate) {
    return { success: false, error: 'team_load_failed' };
  }
  const assignmentsByOriginalStartLocal = new Map<
    string,
    PlanningAssignmentDraft[]
  >();
  const assignments = occurrences.flatMap((occurrence) => {
    const occurrenceAssignments = [
      ...new Map(
        [
          ...directAssignments,
          ...(teamAssignmentsByDate.get(
            occurrence.originalStartLocal.slice(0, 10)
          ) ?? []),
        ].map((assignment) => [assignment.employeeRecordId, assignment])
      ).values(),
    ];
    assignmentsByOriginalStartLocal.set(
      occurrence.originalStartLocal,
      occurrenceAssignments
    );
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
  if (assessment.conflicts.length > 0) {
    if (!approval?.overrideReason) {
      return {
        success: false,
        error: 'planning_warning',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
    if (
      approval.assessmentFingerprint !== assessment.assessmentFingerprint
    ) {
      return {
        success: false,
        error: 'stale_assessment',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
  }

  const { data, error } = await admin.rpc(
    'extend_planning_series_materialization',
    {
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
    }
  );
  if (error) {
    logPlanningRpcFailure('Failed to extend planning series horizon', error);
    return {
      success: false,
      error: error.message.includes('stale_planning_series')
        ? 'stale_series'
        : 'extension_failed',
    };
  }
  revalidatePlanningMutation(auth.context.orgId);
  return { success: true, occurrenceIds: (data ?? []) as string[] };
}

export type UpdatePlanningCalendarInput = {
  plannedDate?: string;
  plannedTime?: string;
  estimatedDurationMinutes?: number | null;
  selectedUserIds?: string[];
  selectedEmployeeRecordIds?: string[];
  overrideReason?: string | null;
  assessmentFingerprint?: string | null;
};

export async function updatePlanningCalendarEntry(
  occurrenceId: string,
  rawInput: UpdatePlanningCalendarInput
) {
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
    .select('id, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local, version')
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
  if (assignmentError) return { success: false as const, error: 'load_failed' };

  let assignments: PlanningAssignmentDraft[] = (currentAssignments ?? []).map(
    (assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: assignment.team_source_id,
    })
  );
  if (input.selectedEmployeeRecordIds) {
    const recordIds = [...new Set(input.selectedEmployeeRecordIds)];
    const { data: records, error: recordsError } = recordIds.length
      ? await admin
          .from('employee_records')
          .select('id')
          .eq('organization_id', auth.context.orgId)
          .in('id', recordIds)
      : { data: [], error: null };
    if (recordsError || (records ?? []).length !== recordIds.length) {
      return { success: false as const, error: 'employee_not_found' };
    }
    assignments = recordIds.map((employeeRecordId) => ({
      employeeRecordId,
      teamSourceId: null,
    }));
  } else if (input.selectedUserIds) {
    const userIds = [...new Set(input.selectedUserIds)];
    const { data: records, error: recordsError } = userIds.length
      ? await admin
          .from('employee_records')
          .select('id, user_id')
          .eq('organization_id', auth.context.orgId)
          .in('user_id', userIds)
      : { data: [], error: null };
    if (
      recordsError ||
      (records ?? []).length !== userIds.length
    ) {
      return { success: false as const, error: 'member_not_found' };
    }
    assignments = (records ?? []).map((record) => ({
      employeeRecordId: record.id,
      teamSourceId: null,
    }));
  }

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
      Math.round(
        (new Date(occurrence.end_at).getTime() -
          new Date(occurrence.start_at).getTime()) /
          60_000
      );
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
    const durationDays = Math.round(
      (new Date(`${occurrence.end_date_exclusive}T00:00:00Z`).getTime() -
        new Date(`${occurrence.start_date}T00:00:00Z`).getTime()) /
        86_400_000
    );
    const startDate = input.plannedDate ?? occurrence.start_date;
    materialized = {
      originalStartLocal: occurrence.original_start_local ?? `${startDate}T00:00`,
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate,
      endDateExclusive: new Date(
        new Date(`${startDate}T00:00:00Z`).getTime() +
          durationDays * 86_400_000
      )
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
  if (assessment.conflicts.length > 0) {
    if (!input.overrideReason) {
      return {
        success: false as const,
        error: 'planning_warning',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
    if (input.assessmentFingerprint !== assessment.assessmentFingerprint) {
      return {
        success: false as const,
        error: 'stale_assessment',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
  }
  const { data: version, error: updateError } = await admin.rpc(
    'update_planning_occurrence',
    {
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
    }
  );
  if (updateError) {
    logPlanningRpcFailure('Failed to update planning occurrence', updateError);
    return {
      success: false as const,
      error: updateError.message.includes('stale_planning_occurrence')
        ? 'stale_occurrence'
        : updateError.message.includes('started_planning_occurrence_immutable')
          ? 'started_occurrence'
          : 'update_failed',
    };
  }
  revalidatePlanningMutation(auth.context.orgId);
  return { success: true as const, version: version as number };
}

export async function reschedulePlanningSeries(
  occurrenceId: string,
  scope: 'future' | 'series',
  rawInput: UpdatePlanningCalendarInput
) {
  const parsed = updatePlanningCalendarSchema.safeParse(rawInput);
  if (
    !parsed.success ||
    !planningIdSchema.safeParse(occurrenceId).success ||
    (scope !== 'future' && scope !== 'series')
  ) {
    return { success: false as const, error: 'invalid_input' };
  }
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: selected, error: selectedError } = await admin
    .from('planning_occurrences')
    .select('id, series_id, series_lineage_id, original_start_local, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, version')
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
  const { data: lineageOccurrences, error: lineageError } = await admin
    .from('planning_occurrences')
    .select('id, series_id, original_start_local, start_at, start_date, status, is_exception')
    .eq('organization_id', auth.context.orgId)
    .eq('series_lineage_id', selected.series_lineage_id)
    .not('original_start_local', 'is', null)
    .order('original_start_local', { ascending: true })
    .limit(1001);
  if (lineageError || (lineageOccurrences?.length ?? 0) > 1000) {
    return { success: false as const, error: 'load_failed' };
  }
  const now = Date.now();
  const today = formatBerlinLocalDateTime(new Date()).slice(0, 10);
  const mutable = (lineageOccurrences ?? []).filter((occurrence) => {
    if (!occurrence.original_start_local || occurrence.is_exception) return false;
    if (scope === 'future' && occurrence.original_start_local < selected.original_start_local!) {
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
    occurrence.original_start_local ? [occurrence.original_start_local] : []
  );
  const selectedCurrentLocal = selected.start_at
    ? formatBerlinLocalDateTime(selected.start_at)
    : `${selected.start_date}T00:00`;
  const requestedDate = input.plannedDate ?? selectedCurrentLocal.slice(0, 10);
  const requestedTime =
    selected.time_kind === 'timed'
      ? input.plannedTime ?? selectedCurrentLocal.slice(11, 16)
      : '00:00';
  const dayShift = Math.round(
    (new Date(`${requestedDate}T00:00:00Z`).getTime() -
      new Date(`${selectedCurrentLocal.slice(0, 10)}T00:00:00Z`).getTime()) /
      86_400_000
  );
  const boundaryOriginal = identityOriginals[0];
  const positionsBeforeBoundary = (lineageOccurrences ?? []).filter(
    (occurrence) =>
      occurrence.original_start_local &&
      occurrence.original_start_local < boundaryOriginal
  ).length;
  const remainingOccurrenceCount = series.occurrence_count
    ? Math.max(
        identityOriginals.length,
        series.occurrence_count - positionsBeforeBoundary
      )
    : null;
  const startsAtLocal = `${addLocalDays(
    boundaryOriginal.slice(0, 10),
    dayShift
  )}T${requestedTime}`;
  const existingDurationMinutes =
    selected.start_at && selected.end_at
      ? Math.round(
          (new Date(selected.end_at).getTime() -
            new Date(selected.start_at).getTime()) /
            60_000
        )
      : null;
  const existingDurationDays =
    selected.start_date && selected.end_date_exclusive
      ? Math.round(
          (new Date(`${selected.end_date_exclusive}T00:00:00Z`).getTime() -
            new Date(`${selected.start_date}T00:00:00Z`).getTime()) /
            86_400_000
        )
      : null;
  const draft: PlanningSeriesDraft = {
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
        ? input.estimatedDurationMinutes ?? existingDurationMinutes ?? series.duration_minutes
        : null,
    durationDays:
      series.time_kind === 'all_day'
        ? existingDurationDays ?? series.duration_days
        : null,
    timezone: 'Europe/Berlin',
    frequency: series.recurrence_frequency as PlanningSeriesDraft['frequency'],
    interval: series.recurrence_interval,
    weekdays: series.weekdays,
    monthDay: series.month_day,
    occurrenceCount: remainingOccurrenceCount,
    untilLocalDate: series.until_local_date,
  };
  const horizon = addLocalMonthsClamped(startsAtLocal.slice(0, 10), 18);
  const generated = materializeSeries(draft, horizon).slice(
    0,
    identityOriginals.length
  );
  if (generated.length !== identityOriginals.length) {
    return { success: false as const, error: 'invalid_recurrence' };
  }
  const { data: assignmentRows, error: assignmentsError } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id, team_source_id')
    .eq('organization_id', auth.context.orgId)
    .eq('occurrence_id', occurrenceId);
  if (assignmentsError) return { success: false as const, error: 'load_failed' };
  let teamIds = [
    ...new Set(
      (assignmentRows ?? []).flatMap((assignment) =>
        assignment.team_source_id ? [assignment.team_source_id] : []
      )
    ),
  ];
  let directAssignments: PlanningAssignmentDraft[] = (assignmentRows ?? [])
    .filter((assignment) => !assignment.team_source_id)
    .map((assignment) => ({
      employeeRecordId: assignment.employee_record_id,
      teamSourceId: null,
    }));
  if (input.selectedEmployeeRecordIds) {
    const recordIds = [...new Set(input.selectedEmployeeRecordIds)];
    const { data: records, error: recordsError } = recordIds.length
      ? await admin
          .from('employee_records')
          .select('id')
          .eq('organization_id', auth.context.orgId)
          .in('id', recordIds)
      : { data: [], error: null };
    if (recordsError || (records ?? []).length !== recordIds.length) {
      return { success: false as const, error: 'employee_not_found' };
    }
    directAssignments = recordIds.map((employeeRecordId) => ({
      employeeRecordId,
      teamSourceId: null,
    }));
    teamIds = [];
  }
  const teamAssignmentsByDate = await expandPlanningTeamsForDates({
    admin,
    orgId: auth.context.orgId,
    teamIds,
    localDates: generated.map((occurrence) =>
      occurrence.originalStartLocal.slice(0, 10)
    ),
  });
  if (!teamAssignmentsByDate) {
    return { success: false as const, error: 'team_load_failed' };
  }
  const assignmentsByOriginalStartLocal = new Map<
    string,
    PlanningAssignmentDraft[]
  >();
  for (const occurrence of generated) {
    assignmentsByOriginalStartLocal.set(
      occurrence.originalStartLocal,
      [
        ...new Map(
          [
            ...directAssignments,
            ...(teamAssignmentsByDate.get(
              occurrence.originalStartLocal.slice(0, 10)
            ) ?? []),
          ].map((assignment) => [assignment.employeeRecordId, assignment])
        ).values(),
      ]
    );
  }
  const assessment = await assessPlanningOccurrences({
    orgId: auth.context.orgId,
    jobId: selected.job_id,
    occurrences: generated,
    assignments: [],
    assignmentsByOriginalStartLocal,
    excludeOccurrenceIds: mutable.map((occurrence) => occurrence.id),
  });
  if (!assessment) return { success: false as const, error: 'assessment_failed' };
  if (assessment.conflicts.length > 0) {
    if (!input.overrideReason) {
      return {
        success: false as const,
        error: 'planning_warning',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
    if (input.assessmentFingerprint !== assessment.assessmentFingerprint) {
      return {
        success: false as const,
        error: 'stale_assessment',
        conflicts: assessment.conflicts,
        fingerprint: assessment.assessmentFingerprint,
      };
    }
  }
  const occurrencePayload = generated.map((occurrence, index) => ({
    ...occurrence,
    identityOriginalStartLocal:
      identityOriginals[index] ?? occurrence.originalStartLocal,
  }));
  const assignmentPayload = occurrencePayload.flatMap(
    (occurrence) =>
      (assignmentsByOriginalStartLocal.get(
        occurrence.originalStartLocal
      ) ?? []).map((assignment) => ({
        ...assignment,
        occurrenceOriginalStartLocal:
          occurrence.identityOriginalStartLocal,
      }))
  );
  const { data, error } = await admin.rpc('reschedule_planning_series', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_occurrence_id: occurrenceId,
    p_expected_version: selected.version,
    p_scope: scope,
    p_series: {
      ...draft,
      generatedThroughLocal:
        occurrencePayload.at(-1)?.identityOriginalStartLocal ?? null,
    },
    p_occurrences: occurrencePayload,
    p_assignments: assignmentPayload,
    p_capacity_snapshot: assessment.capacitySnapshot,
    p_capacity_fingerprint: assessment.capacityFingerprint,
    p_qualification_snapshot: assessment.qualificationSnapshot,
    p_qualification_fingerprint: assessment.qualificationFingerprint,
    p_override_reason: input.overrideReason ?? null,
  });
  if (error) {
    logPlanningRpcFailure('Failed to reschedule planning series', error);
    return { success: false as const, error: 'update_failed' };
  }
  revalidatePlanningMutation(auth.context.orgId);
  return { success: true as const, occurrenceIds: (data ?? []) as string[] };
}

export async function setPlanningOccurrenceStatus(
  occurrenceId: string,
  status: 'skipped' | 'cancelled',
  reason: string
) {
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
  const { data: version, error: updateError } = await admin.rpc(
    'set_planning_occurrence_status',
    {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_occurrence_id: occurrenceId,
      p_expected_version: occurrence.version,
      p_status: parsed.data.status,
      p_reason: parsed.data.reason,
    }
  );
  if (updateError) {
    logPlanningRpcFailure('Failed to change planning occurrence status', updateError);
    return { success: false as const, error: 'update_failed' };
  }
  revalidatePlanningMutation(auth.context.orgId);
  return { success: true as const, version: version as number };
}
