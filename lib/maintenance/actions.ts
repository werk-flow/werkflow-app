'use server';

import { revalidatePath, updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { JOB_CREATION_REFUSALS, prepareJobCreation } from '@/lib/jobs/creation';
import { addLocalMonthsClamped, formatBerlinLocalDate } from '@/lib/planning/date-time';
import { preparePlanningCreation } from '@/lib/planning/creation';
import { createPlanningEntrySchema } from '@/lib/planning/schemas';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type {
  FieldMaintenanceContext,
  MaintenanceActionResult,
  MaintenanceCoverageInput,
  MaintenanceEvidenceOption,
  MaintenancePlanInput,
  MaintenanceWorkspaceResult,
} from './types';
import {
  maintenanceArchiveSchema,
  maintenanceCompletionSchema,
  maintenanceCoverageSchema,
  maintenanceExceptionSchema,
  maintenancePlanSchema,
  maintenanceScheduleSchema,
  maintenanceServiceCaseLinkSchema,
  maintenanceTransitionSchema,
  maintenanceVisitLinkSchema,
} from './validation';
import { logError } from '@/lib/logging';
import { requireServiceManager } from '@/lib/service-cases/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { maintenanceWorkspaceQuerySchema, type MaintenanceWorkspaceQuery } from './workspace-page';
import { readMaintenanceWorkspace } from './workspace-reads';

function mutationError(error: { message?: string } | null, fallback: string): string {
  const known = [
    'maintenance_not_authorized',
    'maintenance_idempotency_conflict',
    'maintenance_stale_version',
    'maintenance_reason_required',
    'maintenance_coverage_not_found',
    'maintenance_coverage_site_mismatch',
    'maintenance_plan_not_found',
    'maintenance_plan_site_mismatch',
    'maintenance_plan_coverage_mismatch',
    'maintenance_plan_equipment_mismatch',
    'maintenance_template_version_unavailable',
    'maintenance_overlap_reason_required',
    'maintenance_plan_transition_not_allowed',
    'maintenance_plan_archive_requires_terminated',
    'maintenance_plan_generation_not_allowed',
    'maintenance_generation_horizon_invalid',
    'maintenance_due_not_found',
    'maintenance_due_batch_invalid',
    'maintenance_due_visit_not_allowed',
    'maintenance_due_job_mismatch',
    'maintenance_due_occurrence_mismatch',
    'maintenance_due_exception_not_allowed',
    'maintenance_due_completion_not_allowed',
    'maintenance_completion_date_invalid',
    'maintenance_due_evidence_required',
    'maintenance_due_evidence_mismatch',
  ];
  return known.find((value) => error?.message?.includes(value)) ?? fallback;
}

/** The end of the due work window a plan write generates: today in Berlin plus 18 months. */
function dueWorkHorizonDate(): string {
  return addLocalMonthsClamped(formatBerlinLocalDate(new Date()), 18);
}

function refreshMaintenancePaths(): void {
  revalidatePath('/service/wartung');
  revalidatePath('/auftraege');
}

/**
 * One page of each maintenance workspace list with the editors' catalogs.
 * The page render and the live refresh (background read
 * `maintenance-workspace`) both read through it. Office roles only.
 */
export async function getMaintenanceWorkspace(
  rawQuery: MaintenanceWorkspaceQuery,
): Promise<MaintenanceWorkspaceResult> {
  const parsedQuery = maintenanceWorkspaceQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  return readMaintenanceWorkspace(context, parsedQuery.data);
}

export async function createMaintenanceCoverage(
  input: MaintenanceCoverageInput,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceCoverageSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { error } = await context.admin.rpc('create_maintenance_coverage', {
    p_organization_id: context.organizationId,
    p_maintenance_coverage_id: parsed.data.coverageId,
    p_payload: toJson(parsed.data),
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_coverage_create_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function createMaintenancePlan(input: MaintenancePlanInput): Promise<MaintenanceActionResult> {
  const parsed = maintenancePlanSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  // One call: an active plan and its due work are saved together or not at all.
  const { data, error } = await context.admin.rpc('create_maintenance_plan_with_due_work', {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data.planId,
    p_revision_id: parsed.data.revisionId,
    p_payload: toJson(parsed.data),
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_through_date: dueWorkHorizonDate(),
  });
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_plan_create_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function reviseMaintenancePlan(
  input: MaintenancePlanInput & { expectedVersion: number },
): Promise<MaintenanceActionResult> {
  // safeExtend keeps the date refinement; extend throws on a refined schema.
  const parsed = maintenancePlanSchema
    .safeExtend({
      expectedVersion: maintenanceTransitionSchema.shape.expectedVersion,
    })
    .safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const payload = {
    templateVersionId: parsed.data.templateVersionId,
    effectiveFromDate: parsed.data.effectiveFromDate,
    firstDueDate: parsed.data.firstDueDate,
    intervalMonths: parsed.data.intervalMonths,
    dueWindowBeforeDays: parsed.data.dueWindowBeforeDays,
    dueWindowAfterDays: parsed.data.dueWindowAfterDays,
    plannedDurationMinutes: parsed.data.plannedDurationMinutes,
    nextDueBasis: parsed.data.nextDueBasis,
    operationalInstructions: parsed.data.operationalInstructions ?? null,
    overlapReason: parsed.data.overlapReason ?? null,
    equipmentIds: parsed.data.equipmentIds,
  };
  const { data, error } = await context.admin.rpc('revise_maintenance_plan_with_due_work', {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data.planId,
    p_revision_id: parsed.data.revisionId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: payload,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_through_date: dueWorkHorizonDate(),
  });
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_plan_revision_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function transitionMaintenancePlan(input: unknown): Promise<MaintenanceActionResult> {
  const parsed = maintenanceTransitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { data, error } = await context.admin.rpc('transition_maintenance_plan_with_due_work', {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data.planId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_status: parsed.data.toStatus,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_through_date: dueWorkHorizonDate(),
  });
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_transition_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function setMaintenancePlanArchived(rawInput: {
  planId: string;
  expectedVersion: number;
  archived: boolean;
  reason: string;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  const parsedInput = maintenanceArchiveSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { error } = await context.admin.rpc('set_maintenance_plan_archived', {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: input.planId,
    p_expected_version: input.expectedVersion,
    p_archived: input.archived,
    p_reason: input.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, 'maintenance_archive_failed'),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function createMaintenanceVisit(input: {
  dueWorkIds: string[];
  expectedVersions: number[];
  reason: string;
  idempotencyKey: string;
}): Promise<ActionResult<{ jobNumber: string }>> {
  const parsed = maintenanceVisitLinkSchema
    .omit({ jobId: true, planningOccurrenceId: true })
    .safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { data: replayEvents, error: replayError } = await context.admin
    .from('maintenance_due_work_events')
    .select('maintenance_due_work_id, request_payload')
    .eq('organization_id', context.organizationId)
    .eq('idempotency_key', parsed.data.idempotencyKey)
    .like('request_operation', 'due_visit_link:%');
  if (replayError) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  if (replayEvents.length > 0) {
    const replayDueIds = new Set(replayEvents.map((event) => event.maintenance_due_work_id));
    const replayJobIds = new Set(
      replayEvents.flatMap((event) => {
        const payload = event.request_payload as Record<string, unknown>;
        return typeof payload.jobId === 'string' ? [payload.jobId] : [];
      }),
    );
    const replayMatches =
      replayDueIds.size === parsed.data.dueWorkIds.length &&
      parsed.data.dueWorkIds.every((dueWorkId) => replayDueIds.has(dueWorkId)) &&
      replayJobIds.size === 1;
    const replayJobId = [...replayJobIds][0];
    if (!replayMatches || !replayJobId) {
      return { success: false, error: 'maintenance_idempotency_conflict' };
    }
    const { data: replayJob, error: replayJobError } = await context.admin
      .from('jobs')
      .select('job_number')
      .eq('organization_id', context.organizationId)
      .eq('id', replayJobId)
      .single();
    if (replayJobError || !replayJob.job_number) {
      return { success: false, error: 'maintenance_visit_context_failed' };
    }
    refreshMaintenancePaths();
    return { success: true, jobNumber: replayJob.job_number };
  }
  const { data: dueRows, error: dueError } = await readInBatches(parsed.data.dueWorkIds, (batch) =>
    context.admin
      .from('maintenance_due_work')
      .select('id, maintenance_plan_id, maintenance_plan_revision_id, due_date')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (dueError) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  if (dueRows.length !== parsed.data.dueWorkIds.length) {
    return { success: false, error: 'maintenance_due_not_found' };
  }
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [...new Set(dueRows.map((row) => row.maintenance_plan_revision_id))];
  const [plansResult, revisionsResult] = await Promise.all([
    readInBatches(planIds, (batch) =>
      context.admin
        .from('maintenance_plans')
        .select('id, plan_number, client_id, site_id')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      context.admin
        .from('maintenance_plan_revisions')
        .select('id, template_version_id, planned_duration_minutes, operational_instructions')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (plansResult.error || revisionsResult.error) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const plans = plansResult.data;
  const revisions = revisionsResult.data;
  if (!plans.length || !revisions.length) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const clientIds = new Set(plans.map((plan) => plan.client_id));
  const siteIds = new Set(plans.map((plan) => plan.site_id));
  const templateIds = new Set(revisions.map((revision) => revision.template_version_id));
  if (clientIds.size !== 1 || siteIds.size !== 1 || templateIds.size !== 1) {
    return { success: false, error: 'maintenance_due_batch_incompatible' };
  }
  const [firstPlan] = plans;
  const [firstRevision] = revisions;
  if (!firstPlan || !firstRevision) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  const durationByRevisionId = new Map(
    revisions.map((revision) => [revision.id, revision.planned_duration_minutes]),
  );
  const estimatedDurationMinutes = dueRows.reduce(
    (total, due) => total + (durationByRevisionId.get(due.maintenance_plan_revision_id) ?? 0),
    0,
  );
  if (dueRows.some((due) => !durationByRevisionId.has(due.maintenance_plan_revision_id))) {
    return { success: false, error: 'maintenance_visit_context_failed' };
  }
  if (estimatedDurationMinutes < 15 || estimatedDurationMinutes > 10_080) {
    return { success: false, error: 'maintenance_due_batch_incompatible' };
  }
  const prepared = await prepareJobCreation(
    { admin: context.admin, orgId: context.organizationId, actorId: context.actorId },
    {
      title: `Wartung · ${plans.map((plan) => plan.plan_number).join(', ')}`,
      ...(firstRevision.operational_instructions !== null
        ? { description: firstRevision.operational_instructions }
        : {}),
      clientId: firstPlan.client_id,
      siteId: firstPlan.site_id,
      estimatedDurationMinutes,
      templateVersionId: firstRevision.template_version_id,
      selectedUserIds: [],
    },
    null,
  );
  if (!prepared.success) return prepared;
  // One call: the job takes the next number, gets the plan's template and is
  // linked to the due items, or nothing changes and the number stays free.
  const { data, error } = await context.admin.rpc(
    'create_maintenance_visit_job',
    rpcArgs('create_maintenance_visit_job', {
      ...prepared.arguments,
      p_organization_id: context.organizationId,
      p_actor_id: context.actorId,
      p_maintenance_due_work_ids: parsed.data.dueWorkIds,
      p_expected_versions: parsed.data.expectedVersions,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotencyKey,
    }),
  );
  if (error || !data.job_number) {
    const jobRefusal = JOB_CREATION_REFUSALS.find((code) => code === error?.message);
    if (!jobRefusal) logError('Failed to create maintenance visit:', error);
    return {
      success: false,
      error: jobRefusal ?? mutationError(error, 'maintenance_visit_create_failed'),
    };
  }
  updateTag(CACHE_TAGS.workTemplates(context.organizationId));
  refreshMaintenancePaths();
  return { success: true, jobNumber: data.job_number };
}

export async function scheduleMaintenanceVisit(input: {
  dueWorkId: string;
  expectedVersion: number;
  jobId: string;
  startsAtLocal: string;
  durationMinutes: number;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  const parsed = maintenanceScheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const planningInput = createPlanningEntrySchema.safeParse({
    entryKind: 'job_visit',
    internalType: null,
    jobId: parsed.data.jobId,
    title: null,
    description: null,
    location: null,
    timeKind: 'timed',
    startsAtLocal: parsed.data.startsAtLocal,
    durationMinutes: parsed.data.durationMinutes,
    durationDays: null,
    assignmentDrafts: [],
    teamIds: [],
    overrideReason: null,
    assessmentFingerprint: null,
    idempotencyKey: parsed.data.idempotencyKey,
    recurrence: null,
  });
  if (!planningInput.success) return { success: false, error: 'invalid_input' };
  const prepared = await preparePlanningCreation(planningInput.data, context.organizationId);
  if (!prepared.success) return { success: false, error: prepared.error };
  const [occurrence] = prepared.occurrences;
  if (!occurrence || prepared.occurrences.length !== 1) {
    return { success: false, error: 'maintenance_schedule_failed' };
  }
  // One call: the appointment and its link to the due item are saved together or not at all.
  const { error } = await context.admin.rpc('schedule_maintenance_visit', {
    p_organization_id: context.organizationId,
    p_actor_id: context.actorId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_occurrence: occurrence,
    p_assignments: prepared.assignments,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_capacity_snapshot: prepared.capacitySnapshot,
    p_capacity_fingerprint: prepared.capacityFingerprint,
    p_qualification_snapshot: prepared.qualificationSnapshot,
    p_qualification_fingerprint: prepared.qualificationFingerprint,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_schedule_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function setMaintenanceDueException(input: unknown): Promise<MaintenanceActionResult> {
  const parsed = maintenanceExceptionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { error } = await context.admin.rpc('set_maintenance_due_exception', {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_status: parsed.data.toStatus,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, 'maintenance_exception_failed'),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function completeMaintenanceDueWork(input: unknown): Promise<MaintenanceActionResult> {
  const parsed = maintenanceCompletionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { error } = await context.admin.rpc('complete_maintenance_due_work', {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_scope_outcome: parsed.data.scopeOutcome,
    p_completed_on: parsed.data.completedOn,
    p_work_artifact_revision_ids: parsed.data.workArtifactRevisionIds,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, 'maintenance_completion_failed'),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function linkMaintenanceServiceCase(rawInput: {
  planId: string;
  dueWorkId: string;
  expectedDueVersion: number;
  serviceCaseId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  const parsedInput = maintenanceServiceCaseLinkSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { error } = await context.admin.rpc('link_maintenance_service_case', {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: input.planId,
    p_maintenance_due_work_id: input.dueWorkId,
    p_service_case_id: input.serviceCaseId,
    p_expected_due_version: input.expectedDueVersion,
    p_reason: input.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, 'maintenance_service_case_link_failed'),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function getMaintenanceEvidenceOptions(
  rawJobId: string,
): Promise<ActionResult<{ options: MaintenanceEvidenceOption[] }>> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'invalid_input' };
  const jobId = parsedJobId.data;
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { data: artifacts, error } = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('work_artifacts')
        .select('current_revision_id')
        .eq('organization_id', context.organizationId)
        .eq('job_id', jobId)
        .is('voided_at', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('getMaintenanceEvidenceOptions: artifact read failed', {
      code: error.code,
      message: error.message,
    });
    return { success: false, error: 'maintenance_evidence_load_failed' };
  }
  const revisionIds = artifacts.flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  const { data: revisions, error: revisionError } = await readInBatches(revisionIds, (batch) =>
    context.admin
      .from('work_artifact_revisions')
      .select('id, title, revision_number')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (revisionError) {
    logReadFailure('getMaintenanceEvidenceOptions: revision read failed', {
      code: revisionError.code,
      message: revisionError.message,
    });
    return { success: false, error: 'maintenance_evidence_load_failed' };
  }
  return {
    success: true,
    // Highest revision number first, across batches.
    options: revisions
      .sort((left, right) => right.revision_number - left.revision_number)
      .map((revision) => ({
        revisionId: revision.id,
        title: revision.title,
        revisionNumber: revision.revision_number,
      })),
  };
}

export async function getAssignedMaintenanceContextForJob(
  rawJobId: string,
): Promise<ActionResult<{ contexts: FieldMaintenanceContext[] }>> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'not_authorized' };
  const jobId = parsedJobId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await admin
      .from('job_assignments')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('job_id', jobId)
      .eq('user_id', auth.context.userId)
      .maybeSingle();
    if (assignmentError) {
      logReadErrors('getAssignedMaintenanceContextForJob: read failed', assignmentError);
      return { success: false, error: 'maintenance_context_load_failed' };
    }
    if (!assignment) return { success: false, error: 'not_authorized' };
  }
  const { data: dueRows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('maintenance_due_work')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .eq('job_id', jobId)
        .in('status', ['visit_created', 'completed'])
        .order('due_date')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('getAssignedMaintenanceContextForJob: due work read failed', {
      code: error.code,
      message: error.message,
    });
    return { success: false, error: 'maintenance_context_load_failed' };
  }
  if (dueRows.length === 0) return { success: true, contexts: [] };
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [...new Set(dueRows.map((row) => row.maintenance_plan_revision_id))];
  const [plansResult, revisionsResult, linksResult] = await Promise.all([
    readInBatches(planIds, (batch) =>
      admin
        .from('maintenance_plans')
        .select('id, plan_number')
        .eq('organization_id', auth.context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      admin
        .from('maintenance_plan_revisions')
        .select('id, template_version_id, operational_instructions')
        .eq('organization_id', auth.context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('maintenance_plan_revision_equipment')
            .select('maintenance_plan_revision_id, equipment_id')
            .eq('organization_id', auth.context.orgId)
            .in('maintenance_plan_revision_id', [...batch])
            .order('maintenance_plan_revision_id')
            .order('equipment_id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const contextError = plansResult.error ?? revisionsResult.error ?? linksResult.error;
  if (contextError) {
    logReadFailure('getAssignedMaintenanceContextForJob: plan read failed', {
      code: contextError.code,
      message: contextError.message,
    });
    return { success: false, error: 'maintenance_context_load_failed' };
  }
  const plans = plansResult.data;
  const revisions = revisionsResult.data;
  const links = linksResult.data;
  const [templatesResult, equipmentRowsResult] = await Promise.all([
    readInBatches(
      revisions.map((row) => row.template_version_id),
      (batch) =>
        admin
          .from('work_template_versions')
          .select('id, name, version_number')
          .eq('organization_id', auth.context.orgId)
          .in('id', [...batch]),
    ),
    readInBatches(
      links.map((row) => row.equipment_id),
      (batch) =>
        admin
          .from('installed_equipment')
          .select('id, equipment_number, name')
          .eq('organization_id', auth.context.orgId)
          .in('id', [...batch]),
    ),
  ]);
  const detailError = templatesResult.error ?? equipmentRowsResult.error;
  if (detailError) {
    logReadFailure('getAssignedMaintenanceContextForJob: template or equipment read failed', {
      code: detailError.code,
      message: detailError.message,
    });
    return { success: false, error: 'maintenance_context_load_failed' };
  }
  const plansById = new Map(plans.map((row) => [row.id, row]));
  const revisionsById = new Map(revisions.map((row) => [row.id, row]));
  const templatesById = new Map(templatesResult.data.map((row) => [row.id, row]));
  const equipmentById = new Map(
    equipmentRowsResult.data.map((row) => [
      row.id,
      { id: row.id, equipmentNumber: row.equipment_number, name: row.name },
    ]),
  );
  const equipmentIdsByRevision = new Map<string, string[]>();
  for (const link of links) {
    const ids = equipmentIdsByRevision.get(link.maintenance_plan_revision_id) ?? [];
    ids.push(link.equipment_id);
    equipmentIdsByRevision.set(link.maintenance_plan_revision_id, ids);
  }
  return {
    success: true,
    contexts: dueRows.flatMap((due) => {
      const plan = plansById.get(due.maintenance_plan_id);
      const revision = revisionsById.get(due.maintenance_plan_revision_id);
      const template = revision ? templatesById.get(revision.template_version_id) : null;
      if (!plan || !revision || !template) return [];
      return [
        {
          planNumber: plan.plan_number,
          dueDate: due.due_date,
          windowStartDate: due.window_start_date,
          windowEndDate: due.window_end_date,
          templateName: template.name,
          templateVersionNumber: template.version_number,
          operationalInstructions: revision.operational_instructions,
          equipment: (equipmentIdsByRevision.get(revision.id) ?? []).flatMap((id) => {
            const item = equipmentById.get(id);
            return item ? [item] : [];
          }),
        },
      ];
    }),
  };
}
