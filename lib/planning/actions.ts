'use server';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { loadPlanningCalendarEntries } from './calendar-entries';
import { preparePlanningCreation } from './creation';
import {
  assignmentRowsFor,
  assignmentsPerOccurrence,
  resolveSelectedPlanningAssignments,
  splitSourceAssignments,
} from './edit-assignments';
import {
  materializeOccurrenceEdit,
  planSeriesReschedule,
  seriesExtensionOccurrences,
  seriesReschedulePayload,
} from './edit-drafts';
import {
  createPlanningEntrySchema,
  planningDateWindowSchema,
  planningIdSchema,
  planningOccurrenceStatusSchema,
  planningRescheduleScopeSchema,
  seriesHorizonApprovalSchema,
  updatePlanningCalendarSchema,
  type ParsedPlanningCalendarInput,
} from './schemas';
import { loadRescheduleSource, loadSeriesExtensionSource } from './series-sources';
import { assessPlanningOccurrences, loadPlanningOptions, type PlanningAssessment } from './server';
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
  return { success: true, occurrenceIds: data ?? [] };
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
  const source = await loadSeriesExtensionSource(admin, auth.context.orgId, seriesId);
  if (!source.success) return source;
  const { series, generatedThroughLocal } = source;
  const { data: sourceAssignments, error: assignmentError } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id, team_source_id')
    .eq('organization_id', auth.context.orgId)
    .eq('occurrence_id', source.sourceOccurrenceId);
  if (assignmentError) {
    logError('Failed to load series source assignments', assignmentError);
    return { success: false, error: 'load_failed' };
  }

  const occurrences = seriesExtensionOccurrences(series, generatedThroughLocal);
  if (occurrences.length === 0) {
    return { success: true, occurrenceIds: [] };
  }
  const assignmentsByOriginalStartLocal = await assignmentsPerOccurrence({
    admin,
    orgId: auth.context.orgId,
    ...splitSourceAssignments(sourceAssignments ?? []),
    occurrences,
  });
  if (!assignmentsByOriginalStartLocal) {
    return { success: false, error: 'team_load_failed' };
  }
  const assessed = await assessSeriesChange({
    orgId: auth.context.orgId,
    jobId: series.job_id,
    occurrences,
    assignmentsByOriginalStartLocal,
    excludeOccurrenceIds: [],
    overrideReason: approval?.overrideReason ?? null,
    assessmentFingerprint: approval?.assessmentFingerprint ?? null,
  });
  if (!assessed.success) return assessed;
  const { assessment } = assessed;

  const { data, error } = await admin.rpc(
    'extend_planning_series_materialization',
    rpcArgs('extend_planning_series_materialization', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_series_id: series.id,
      p_expected_generated_through_local: generatedThroughLocal,
      p_occurrences: occurrences,
      p_assignments: assignmentRowsFor(occurrences, assignmentsByOriginalStartLocal),
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
  return { success: true, occurrenceIds: data ?? [] };
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

/** The code of a refused occurrence update: a newer version, an occurrence that already started, or another failure. */
function occurrenceUpdateFailure(message: string): string {
  if (message.includes('stale_planning_occurrence')) return 'stale_occurrence';
  if (message.includes('started_planning_occurrence_immutable')) return 'started_occurrence';
  return 'update_failed';
}

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

  const edit = materializeOccurrenceEdit(occurrence, input);
  if (!edit.success) return edit;
  const assessment = await assessPlanningOccurrences({
    orgId: auth.context.orgId,
    jobId: occurrence.job_id,
    occurrences: [edit.materialized],
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
      p_occurrence: edit.materialized,
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
    return { success: false as const, error: occurrenceUpdateFailure(updateError.message) };
  }
  return { success: true as const, version };
}

/** The assessment of a series change, refused while it holds a conflict the manager has not acknowledged. */
async function assessSeriesChange(input: {
  orgId: string;
  jobId: string | null;
  occurrences: MaterializedOccurrence[];
  assignmentsByOriginalStartLocal: Map<string, PlanningAssignmentDraft[]>;
  excludeOccurrenceIds: string[];
  overrideReason: string | null;
  assessmentFingerprint: string | null;
}): Promise<{ success: true; assessment: PlanningAssessment } | PlanningActionFailure> {
  const assessment = await assessPlanningOccurrences({
    orgId: input.orgId,
    jobId: input.jobId,
    occurrences: input.occurrences,
    assignments: [],
    assignmentsByOriginalStartLocal: input.assignmentsByOriginalStartLocal,
    excludeOccurrenceIds: input.excludeOccurrenceIds,
  });
  if (!assessment) return { success: false as const, error: 'assessment_failed' };
  const conflictRejection = rejectUnacknowledgedConflicts(assessment, {
    overrideReason: input.overrideReason,
    assessmentFingerprint: input.assessmentFingerprint,
  });
  if (conflictRejection) return conflictRejection;
  return { success: true, assessment };
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
  let { teamIds, directAssignments } = splitSourceAssignments(assignmentRows ?? []);
  const selection = await resolveSelectedPlanningAssignments(admin, input.orgId, input.request);
  if (!selection.success) return selection;
  if (selection.assignments) {
    directAssignments = selection.assignments;
    teamIds = [];
  }
  const assignmentsByOriginalStartLocal = await assignmentsPerOccurrence({
    admin,
    orgId: input.orgId,
    teamIds,
    directAssignments,
    occurrences: generated,
  });
  if (!assignmentsByOriginalStartLocal) {
    return { success: false as const, error: 'team_load_failed' };
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
  const source = await loadRescheduleSource(admin, auth.context.orgId, occurrenceId);
  if (!source.success) return source;
  const { selected } = source;
  const plan = planSeriesReschedule({
    series: source.series,
    selected,
    selectedOriginalStartLocal: source.selectedOriginalStartLocal,
    lineageOccurrences: source.lineageOccurrences,
    scope,
    request: input,
    now: Date.now(),
    today: getBusinessTodayIso(),
  });
  if (!plan.success) return plan;
  const assignmentResolution = await resolveSeriesRescheduleAssignments({
    admin,
    orgId: auth.context.orgId,
    occurrenceId,
    request: input,
    generated: plan.generated,
  });
  if (!assignmentResolution.success) return assignmentResolution;
  const { assignmentsByOriginalStartLocal } = assignmentResolution;
  const assessed = await assessSeriesChange({
    orgId: auth.context.orgId,
    jobId: selected.job_id,
    occurrences: plan.generated,
    assignmentsByOriginalStartLocal,
    excludeOccurrenceIds: plan.replacedOccurrenceIds,
    overrideReason: input.overrideReason ?? null,
    assessmentFingerprint: input.assessmentFingerprint ?? null,
  });
  if (!assessed.success) return assessed;
  const { assessment } = assessed;
  const { occurrences, assignments } = seriesReschedulePayload(plan, assignmentsByOriginalStartLocal);
  const { data, error } = await admin.rpc(
    'reschedule_planning_series',
    rpcArgs('reschedule_planning_series', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_occurrence_id: occurrenceId,
      p_expected_version: selected.version,
      p_scope: scope,
      p_series: {
        ...plan.draft,
        generatedThroughLocal: occurrences.at(-1)?.identityOriginalStartLocal ?? null,
      },
      p_occurrences: occurrences,
      p_assignments: assignments,
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
  return { success: true as const, occurrenceIds: data ?? [] };
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
  return { success: true as const, version };
}
