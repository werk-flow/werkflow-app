'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { assignmentApprovalSchema } from '@/lib/jobs/action-schemas';
import { toJob, type UpdateJobResult } from '@/lib/jobs/types';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { prepareJobUpdate } from '@/lib/jobs/update-preparation';
import { workWriteFailure } from '@/lib/jobs/write-refusals';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { composeReadinessForTarget } from '@/lib/dispatch/readiness-target';

import {
  parseWorkLifecycleSnapshot,
  WORK_BLOCKER_REASONS,
  WORK_DECLARED_DEPENDENCY_KINDS,
  WORK_DECLARED_KIND_LABELS,
  WORK_DEPENDENCY_EFFECTS,
  WORK_EXECUTION_STATES,
  type WorkBlockerReason,
  type WorkDeclaredDependencyKind,
  type WorkDependencyEffect,
  type WorkExecutionState,
  type WorkEntityOption,
  type WorkLifecycleSnapshot,
  type WorkTargetType,
} from './types';

const targetSchema = z.object({
  targetType: z.enum(['job', 'project']),
  targetId: uuidSchema,
});
const versionSchema = z.number().int().nonnegative();
const reasonSchema = z.string().trim().min(3).max(1000);
const detailsSchema = z.string().trim().min(3).max(2000);
const workExecutionStateSchema = z.enum(WORK_EXECUTION_STATES);
const workBlockerReasonSchema = z.enum(WORK_BLOCKER_REASONS);
const workDependencyEffectSchema = z.enum(WORK_DEPENDENCY_EFFECTS);
const workDeclaredDependencyKindSchema = z.enum(WORK_DECLARED_DEPENDENCY_KINDS);
const transitionInputSchema = targetSchema.extend({
  expectedVersion: versionSchema,
  toState: workExecutionStateSchema,
  reason: reasonSchema.optional(),
  overrideGates: z.boolean().optional(),
});
const clearProjectOverrideInputSchema = z.object({
  projectId: uuidSchema,
  expectedVersion: versionSchema,
  reason: reasonSchema,
});
const blockerInputSchema = targetSchema
  .extend({
    instructionItemId: uuidSchema.optional(),
    blockerId: uuidSchema.optional(),
    expectedVersion: versionSchema.optional(),
    reason: workBlockerReasonSchema,
    details: detailsSchema.optional(),
    responsibleEmployeeRecordId: uuidSchema,
    nextReviewDate: z.string().date(),
  })
  .refine((value) => value.reason !== 'other' || value.details, {
    message: 'details_required',
  });
const blockerStateInputSchema = z.object({
  blockerId: uuidSchema,
  expectedVersion: versionSchema,
  resolutionNote: reasonSchema,
});
const reopenBlockerInputSchema = z.object({
  blockerId: uuidSchema,
  expectedVersion: versionSchema,
  reason: reasonSchema,
});
const parkInputSchema = targetSchema
  .extend({
    expectedExecutionVersion: versionSchema,
    reason: workBlockerReasonSchema,
    details: detailsSchema.optional(),
    responsibleEmployeeRecordId: uuidSchema,
    nextReviewDate: z.string().date(),
  })
  .refine((value) => value.reason !== 'other' || value.details, {
    message: 'details_required',
  });
const unparkInputSchema = targetSchema.extend({
  blockerVersion: versionSchema,
  reason: reasonSchema,
});
const dependencyPredecessorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job'), id: uuidSchema }),
  z.object({ type: z.literal('project'), id: uuidSchema }),
  z.object({ type: z.literal('instruction'), id: uuidSchema }),
  z.object({
    type: z.literal('declared'),
    kind: workDeclaredDependencyKindSchema,
  }),
]);
const dependencyInputSchema = targetSchema
  .extend({
    dependencyId: uuidSchema.optional(),
    expectedVersion: versionSchema.optional(),
    predecessor: dependencyPredecessorSchema,
    description: z.string().trim().min(3).max(1000).optional(),
    effect: workDependencyEffectSchema,
  })
  .refine((value) => value.predecessor.type !== 'declared' || value.description, {
    message: 'description_required',
  });
const dependencyStateInputSchema = z.object({
  dependencyId: uuidSchema,
  expectedVersion: versionSchema,
  state: z.enum(['open', 'satisfied', 'waived']),
  reason: reasonSchema,
});
const removeDependencyInputSchema = z.object({
  dependencyId: uuidSchema,
  expectedVersion: versionSchema,
  reason: reasonSchema,
});

type WorkFunction<Name extends keyof Database['public']['Functions']> = Database['public']['Functions'][Name];

function revalidateWork(): void {
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/aufgaben', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
}

function mapWorkError(error: { message: string } | null): string {
  const known = [
    'work_transition_stale_version',
    'work_transition_not_allowed',
    'work_transition_not_authorized',
    'work_transition_reason_required',
    'work_transition_start_blocked',
    'work_transition_completion_blocked',
    'work_transition_handover_requires_override',
    'work_blocker_stale_version',
    'work_blocker_not_authorized',
    'work_blocker_invalid_input',
    'work_dependency_stale_version',
    'work_dependency_cycle',
    'work_dependency_self',
    'work_dependency_not_authorized',
    'work_dependency_approval_not_found',
    'work_dependency_approval_action_invalid',
    'work_dependency_approval_target_mismatch',
    'instruction_predecessor_incomplete',
    'instruction_item_stale_version',
    'work_with_history_cannot_be_deleted',
  ].find((code) => error?.message.includes(code));
  return known ?? 'work_action_failed';
}

const predecessorOptionsSchema = z
  .array(z.object({ id: uuidSchema, number: z.string().nullable(), title: z.string() }))
  .max(50);

function toPredecessorOption(record: { id: string; number: string | null; title: string }): {
  value: string;
  label: string;
} {
  return { value: record.id, label: record.number ? `${record.number} · ${record.title}` : record.title };
}

async function loadEntityOptions(
  organizationId: string,
  userId: string,
): Promise<Pick<WorkLifecycleSnapshot, 'ownOwnerId' | 'ownerOptions' | 'predecessorOptions'>> {
  const admin = createSupabaseAdminClient();
  const [employeesResult, jobsResult, projectsResult, instructionsResult] = await Promise.all([
    // Every employee with an account is a possible owner; a cap here
    // dropped owners, and the actor's own record, above 200 employees.
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select('id, user_id')
          .eq('organization_id', organizationId)
          .not('user_id', 'is', null)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    // The first records in natural number order, selected in the database.
    admin.rpc('search_work_predecessor_options', {
      p_organization_id: organizationId,
      p_kind: 'job',
      p_limit: 25,
    }),
    admin.rpc('search_work_predecessor_options', {
      p_organization_id: organizationId,
      p_kind: 'project',
      p_limit: 25,
    }),
    admin
      .from('job_instruction_items')
      .select('id, content, job_id, project_id')
      .eq('organization_id', organizationId)
      .order('created_at')
      .limit(25),
  ]);
  const jobOptions = predecessorOptionsSchema.safeParse(jobsResult.data);
  const projectOptions = predecessorOptionsSchema.safeParse(projectsResult.data);
  const optionsError =
    employeesResult.error ??
    jobsResult.error ??
    projectsResult.error ??
    instructionsResult.error ??
    (jobOptions.success && projectOptions.success ? null : { code: 'malformed_options', message: '' });
  if (optionsError || !jobOptions.success || !projectOptions.success) {
    logReadFailure('loadEntityOptions: option read failed', {
      code: optionsError?.code ?? 'malformed_options',
      message: optionsError?.message ?? '',
    });
    throw new Error('work_options_load_failed');
  }
  const userIds = employeesResult.data.flatMap((employee) => (employee.user_id ? [employee.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logReadFailure('loadEntityOptions: profile read failed', {
      code: profilesResult.error.code,
      message: profilesResult.error.message,
    });
    throw new Error('work_options_load_failed');
  }
  const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
  return {
    ownOwnerId: employeesResult.data.find((employee) => employee.user_id === userId)?.id ?? null,
    ownerOptions: employeesResult.data.map((employee) => {
      const profile = employee.user_id ? profiles.get(employee.user_id) : undefined;
      const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
      return {
        value: employee.id,
        label: name || 'Unbenannte Person',
      };
    }),
    predecessorOptions: {
      job: jobOptions.data.map(toPredecessorOption),
      project: projectOptions.data.map(toPredecessorOption),
      instruction: (instructionsResult.data ?? []).map((instruction) => ({
        value: instruction.id,
        label: instruction.content,
        description: instruction.job_id ? 'Auftragseintrag' : 'Projekteintrag',
      })),
      declared: Object.entries(WORK_DECLARED_KIND_LABELS).map(([value, label]) => ({ value, label })),
    },
  };
}

async function loadOwnOwnerOption(
  organizationId: string,
  userId: string,
): Promise<Pick<WorkLifecycleSnapshot, 'ownOwnerId' | 'ownerOptions' | 'predecessorOptions'>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('work_options_load_failed');
  return {
    ownOwnerId: data?.id ?? null,
    ownerOptions: data ? [{ value: data.id, label: 'Ich' }] : [],
    predecessorOptions: { job: [], project: [], instruction: [], declared: [] },
  };
}

export async function getWorkLifecycleSnapshot(input: {
  targetType: WorkTargetType;
  targetId: string;
}): Promise<ActionResult<{ snapshot: WorkLifecycleSnapshot }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const targetColumn = parsed.data.targetType === 'job' ? 'job_id' : 'project_id';
  let loadErrorCode = 'work_snapshot_load_failed';
  const results = await Promise.all([
    admin.rpc('get_work_lifecycle_snapshot', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_target_type: parsed.data.targetType,
      p_target_id: parsed.data.targetId,
    }),
    auth.context.isManagerOrAbove
      ? loadEntityOptions(auth.context.orgId, auth.context.userId)
      : loadOwnOwnerOption(auth.context.orgId, auth.context.userId),
    parsed.data.targetType === 'job'
      ? composeReadinessForTarget({
          admin,
          orgId: auth.context.orgId,
          occurrenceId: null,
          jobId: parsed.data.targetId,
        })
      : Promise.resolve(null),
    admin
      .from('work_blockers')
      .select('*')
      .eq('organization_id', auth.context.orgId)
      .eq(targetColumn, parsed.data.targetId)
      .eq('state', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(10),
  ]).catch((error: unknown) => {
    loadErrorCode =
      error instanceof Error && error.message === 'work_options_load_failed'
        ? error.message
        : 'work_snapshot_load_failed';
    logError('Failed to load work lifecycle options', loadErrorCode);
    return null;
  });
  if (!results) {
    return { success: false, error: loadErrorCode };
  }
  const [snapshotResult, options, readinessResult, resolvedBlockersResult] = results;
  if (snapshotResult.error || !snapshotResult.data || resolvedBlockersResult.error) {
    logReadErrors(
      'getWorkLifecycleSnapshot: read failed',
      snapshotResult.error,
      resolvedBlockersResult.error,
    );
    return {
      success: false,
      error: mapWorkError(snapshotResult.error ?? resolvedBlockersResult.error),
    };
  }
  const parsedSnapshot = parseWorkLifecycleSnapshot(snapshotResult.data);
  if (!parsedSnapshot.success) {
    logError('Failed to parse work lifecycle snapshot', parsedSnapshot.error);
    return parsedSnapshot;
  }
  return {
    success: true,
    snapshot: {
      ...parsedSnapshot.snapshot,
      ...options,
      resolvedBlockers: resolvedBlockersResult.data ?? [],
      readiness: readinessResult?.success ? readinessResult.readiness : null,
      readinessLoadFailed: readinessResult !== null && !readinessResult.success,
    },
  };
}

export async function searchWorkPredecessors(input: {
  type: 'job' | 'project' | 'instruction';
  query: string;
}): Promise<
  { success: true; options: { value: string; label: string; description?: string }[] } | ActionFailure
> {
  const parsed = z
    .object({
      type: z.enum(['job', 'project', 'instruction']),
      query: z.string().trim().min(2).max(100),
    })
    .safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  if (parsed.data.type !== 'instruction') {
    // The database selects the 50 matches in natural number order; a window
    // cut in text order and sorted afterwards skipped lower numbers.
    const result = await admin.rpc('search_work_predecessor_options', {
      p_organization_id: auth.context.orgId,
      p_kind: parsed.data.type,
      p_search: parsed.data.query,
      p_limit: 50,
    });
    const options = predecessorOptionsSchema.safeParse(result.data);
    if (result.error || !options.success) {
      logReadErrors('searchWorkPredecessors: read failed', result.error);
      return { success: false, error: 'work_options_load_failed' };
    }
    return { success: true, options: options.data.map(toPredecessorOption) };
  }
  const { data, error } = await admin
    .from('job_instruction_items')
    .select('id, content, job_id')
    .eq('organization_id', auth.context.orgId)
    .ilike('content', `%${parsed.data.query}%`)
    .order('created_at')
    .limit(50);
  if (error) {
    logReadErrors('searchWorkPredecessors: read failed', error);
    return { success: false, error: 'work_options_load_failed' };
  }
  return {
    success: true,
    options: data.map((instruction) => ({
      value: instruction.id,
      label: instruction.content,
      description: instruction.job_id ? 'Auftragseintrag' : 'Projekteintrag',
    })),
  };
}

export async function transitionWorkExecution(input: {
  targetType: WorkTargetType;
  targetId: string;
  expectedVersion: number;
  toState: WorkExecutionState;
  reason?: string;
  overrideGates?: boolean;
}): Promise<
  | ActionFailure
  | {
      success: true;
      transition: WorkFunction<'transition_work_execution'>['Returns'][number];
    }
> {
  const parsed = transitionInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('transition_work_execution', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_state: parsed.data.toState,
    ...(parsed.data.reason !== undefined ? { p_reason: parsed.data.reason } : {}),
    p_override_gates: parsed.data.overrideGates ?? false,
  });
  if (error || !data?.[0]) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, transition: data[0] };
}

export async function clearProjectWorkExecutionOverride(input: {
  projectId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ActionFailure | { success: true; version: number }> {
  const parsed = clearProjectOverrideInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc('clear_project_execution_override', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_project_id: parsed.data.projectId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, version: data };
}

export async function saveWorkBlocker(input: {
  targetType: WorkTargetType;
  targetId: string;
  instructionItemId?: string;
  blockerId?: string;
  expectedVersion?: number;
  reason: WorkBlockerReason;
  details?: string;
  responsibleEmployeeRecordId: string;
  nextReviewDate: string;
}): Promise<
  | ActionFailure
  | {
      success: true;
      blocker: WorkFunction<'upsert_work_blocker'>['Returns'];
    }
> {
  const parsed = blockerInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'upsert_work_blocker',
    rpcArgs('upsert_work_blocker', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_blocker_id: parsed.data.blockerId ?? null,
      p_expected_version: parsed.data.expectedVersion ?? null,
      p_job_id:
        parsed.data.targetType === 'job' && !parsed.data.instructionItemId ? parsed.data.targetId : null,
      p_project_id:
        parsed.data.targetType === 'project' && !parsed.data.instructionItemId ? parsed.data.targetId : null,
      p_instruction_item_id: parsed.data.instructionItemId ?? null,
      p_kind: 'blocker',
      p_reason: parsed.data.reason,
      p_details: parsed.data.details ?? null,
      p_responsible_employee_record_id: parsed.data.responsibleEmployeeRecordId,
      p_next_review_date: parsed.data.nextReviewDate,
    }),
  );
  if (error || !data) {
    return { success: false as const, error: mapWorkError(error) };
  }
  revalidateWork();
  return { success: true as const, blocker: data };
}

export async function setWorkBlockerResolved(input: {
  blockerId: string;
  expectedVersion: number;
  resolutionNote: string;
}): Promise<ActionFailure | { success: true; version: number }> {
  const parsed = blockerStateInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc('set_work_blocker_state', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_blocker_id: parsed.data.blockerId,
    p_expected_version: parsed.data.expectedVersion,
    p_state: 'resolved',
    p_note: parsed.data.resolutionNote,
  });
  if (error) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, version: data };
}

export async function reopenWorkBlocker(input: {
  blockerId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ActionFailure | { success: true; version: number }> {
  const parsed = reopenBlockerInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: blocker, error: blockerError } = await admin
    .from('work_blockers')
    .select('reason, details, responsible_employee_record_id, next_review_date')
    .eq('organization_id', auth.context.orgId)
    .eq('id', parsed.data.blockerId)
    .single();
  if (blockerError || !blocker) {
    return { success: false as const, error: mapWorkError(blockerError) };
  }
  if (!blocker.reason || !blocker.responsible_employee_record_id || !blocker.next_review_date) {
    return { success: false as const, error: 'work_blocker_invalid_input' };
  }
  const { data, error } = await admin.rpc(
    'set_work_blocker_state',
    rpcArgs('set_work_blocker_state', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_blocker_id: parsed.data.blockerId,
      p_expected_version: parsed.data.expectedVersion,
      p_state: 'open',
      p_note: parsed.data.reason,
      p_reason: blocker.reason,
      p_details: blocker.details ?? null,
      p_responsible_employee_record_id: blocker.responsible_employee_record_id,
      p_next_review_date: blocker.next_review_date,
    }),
  );
  if (error) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, version: data };
}

export async function parkWorkTarget(input: {
  targetType: WorkTargetType;
  targetId: string;
  expectedExecutionVersion: number;
  reason: WorkBlockerReason;
  details?: string;
  responsibleEmployeeRecordId: string;
  nextReviewDate: string;
}): Promise<ActionFailure | { success: true; blockerId: string }> {
  const parsed = parkInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'park_work_target',
    rpcArgs('park_work_target', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_target_type: parsed.data.targetType,
      p_target_id: parsed.data.targetId,
      p_expected_execution_version: parsed.data.expectedExecutionVersion,
      p_reason: parsed.data.reason,
      p_details: parsed.data.details ?? null,
      p_responsible_employee_record_id: parsed.data.responsibleEmployeeRecordId,
      p_next_review_date: parsed.data.nextReviewDate,
    }),
  );
  if (error || !data) {
    logError('Failed to park work target', error);
    return { success: false as const, error: mapWorkError(error) };
  }
  revalidateWork();
  return { success: true as const, blockerId: data };
}

export async function unparkWorkTarget(input: {
  targetType: WorkTargetType;
  targetId: string;
  blockerVersion: number;
  reason: string;
}): Promise<ActionFailure | { success: true; version: number }> {
  const parsed = unparkInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc('unpark_work_target', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId,
    p_expected_blocker_version: parsed.data.blockerVersion,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, version: data };
}

const unparkScheduleInputSchema = z.object({
  jobId: uuidSchema,
  blockerVersion: versionSchema,
  reason: reasonSchema,
  schedule: z.object({
    plannedDate: z.string().date(),
    plannedTime: z.string().max(5),
    estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
    selectedUserIds: z.array(uuidSchema).max(100),
  }),
  assignmentApproval: assignmentApprovalSchema.nullish(),
});

/** A refusal of the unpark keeps its work code; a refusal of the schedule write is the job edit's. */
function unparkScheduleFailure(error: { message: string }): ActionFailure {
  const workCode = mapWorkError(error);
  if (workCode !== 'work_action_failed') return { success: false, error: workCode };
  if (error.message.startsWith('work_')) {
    logError('Failed to unpark job into schedule', error);
    return { success: false, error: workCode };
  }
  return workWriteFailure('Failed to unpark job into schedule', error, ['job_not_found'], 'update_failed');
}

/**
 * Unpark and schedule in one call (P1-24a, criterion 26). The qualification
 * assessment runs first: a warning returns with nothing changed and the job
 * still parked, and the caller repeats the call with the approval. The unpark
 * and the schedule write then run in one database transaction, so a refused
 * write leaves the job parked with its context.
 */
export async function unparkJobIntoSchedule(input: unknown): Promise<UpdateJobResult> {
  const parsed = unparkScheduleInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { jobId, schedule } = parsed.data;
  const admin = createSupabaseAdminClient();
  const prepared = await prepareJobUpdate({
    admin,
    orgId: auth.context.orgId,
    actorId: auth.context.userId,
    jobId,
    input: {
      plannedDate: schedule.plannedDate,
      plannedTime: schedule.plannedTime,
      ...(schedule.estimatedDurationMinutes !== undefined
        ? { estimatedDurationMinutes: schedule.estimatedDurationMinutes }
        : {}),
      selectedUserIds: schedule.selectedUserIds,
      assignmentApproval: parsed.data.assignmentApproval,
    },
  });
  if (!prepared.success) return prepared;
  const { data, error } = await admin.rpc('unpark_job_into_schedule', {
    ...prepared.arguments,
    p_expected_blocker_version: parsed.data.blockerVersion,
    p_reason: parsed.data.reason,
  });
  if (error) return unparkScheduleFailure(error);
  revalidateWork();
  return { success: true, job: toJob(data) };
}

type DependencyPredecessor =
  | { type: 'job'; id: string }
  | { type: 'project'; id: string }
  | { type: 'instruction'; id: string }
  | { type: 'declared'; kind: WorkDeclaredDependencyKind };

export async function saveWorkDependency(input: {
  targetType: WorkTargetType;
  targetId: string;
  dependencyId?: string;
  expectedVersion?: number;
  predecessor: DependencyPredecessor;
  description?: string;
  effect: WorkDependencyEffect;
}): Promise<
  | ActionFailure
  | {
      success: true;
      dependency: WorkFunction<'upsert_work_dependency'>['Returns'];
    }
> {
  const parsed = dependencyInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const predecessor = parsed.data.predecessor;
  const args = rpcArgs('upsert_work_dependency', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dependency_id: parsed.data.dependencyId ?? null,
    p_expected_version: parsed.data.expectedVersion ?? null,
    p_dependent_job_id: parsed.data.targetType === 'job' ? parsed.data.targetId : null,
    p_dependent_project_id: parsed.data.targetType === 'project' ? parsed.data.targetId : null,
    p_predecessor_job_id: predecessor.type === 'job' ? predecessor.id : null,
    p_predecessor_project_id: predecessor.type === 'project' ? predecessor.id : null,
    p_predecessor_instruction_item_id: predecessor.type === 'instruction' ? predecessor.id : null,
    p_declared_kind: predecessor.type === 'declared' ? predecessor.kind : null,
    p_description: parsed.data.description ?? null,
    p_effect: parsed.data.effect,
  });
  const { data, error } = await createSupabaseAdminClient().rpc('upsert_work_dependency', args);
  if (error || !data) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, dependency: data };
}

export async function setDeclaredWorkDependencyState(input: {
  dependencyId: string;
  expectedVersion: number;
  state: 'open' | 'satisfied' | 'waived';
  reason: string;
}): Promise<
  | ActionFailure
  | {
      success: true;
      dependency: WorkFunction<'set_declared_work_dependency_state'>['Returns'];
    }
> {
  const parsed = dependencyStateInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc('set_declared_work_dependency_state', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dependency_id: parsed.data.dependencyId,
    p_expected_version: parsed.data.expectedVersion,
    p_state: parsed.data.state,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, dependency: data };
}

export async function getApprovedArtifactActionsForTarget(input: {
  targetType: WorkTargetType;
  targetId: string;
}): Promise<ActionFailure | { success: true; options: WorkEntityOption[] }> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const targetColumn = parsed.data.targetType === 'job' ? 'job_id' : 'project_id';
  const { data: artifacts, error: artifactError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_artifacts')
        .select('id, current_revision_id')
        .eq('organization_id', auth.context.orgId)
        .eq(targetColumn, parsed.data.targetId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    LIST_ROW_CAP,
  );
  const revisionIds = artifacts.flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  const [revisions, actions] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      admin
        .from('work_artifact_revisions')
        .select('id, title, revision_number')
        .eq('organization_id', auth.context.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      admin
        .from('work_artifact_actions')
        .select('id, revision_id, created_at')
        .eq('organization_id', auth.context.orgId)
        .eq('action_type', 'internal_approved')
        .in('revision_id', [...batch]),
    ),
  ]);
  const loadError = artifactError ?? revisions.error ?? actions.error;
  if (loadError) {
    logReadFailure('getApprovedArtifactActionsForTarget: approval read failed', { code: loadError.code });
    return { success: false, error: 'work_action_failed' };
  }
  const revisionById = new Map(revisions.data.map((revision) => [revision.id, revision]));
  // Newest approval first, across batches (`created_at`, then `id`, both descending).
  const newestActions = actions.data.sort(
    (left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at) || (left.id < right.id ? 1 : -1),
  );
  const approvalDateFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeZone: 'Europe/Berlin',
  });
  return {
    success: true,
    options: newestActions.flatMap((action) => {
      const revision = revisionById.get(action.revision_id);
      return revision
        ? [
            {
              value: action.id,
              label: revision.title,
              description: `Version ${revision.revision_number} · freigegeben ${approvalDateFormatter.format(new Date(action.created_at))}`,
            },
          ]
        : [];
    }),
  };
}

export async function linkWorkDependencyArtifactApproval(input: {
  dependencyId: string;
  expectedVersion: number;
  actionId: string;
  reason: string;
}): Promise<
  | ActionFailure
  | { success: true; dependency: WorkFunction<'link_work_dependency_artifact_approval'>['Returns'] }
> {
  const parsed = z
    .object({
      dependencyId: uuidSchema,
      expectedVersion: versionSchema,
      actionId: uuidSchema,
      reason: reasonSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { data, error } = await createSupabaseAdminClient().rpc('link_work_dependency_artifact_approval', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dependency_id: parsed.data.dependencyId,
    p_expected_version: parsed.data.expectedVersion,
    p_action_id: parsed.data.actionId,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { success: false, error: mapWorkError(error) };
  revalidateWork();
  return { success: true, dependency: data };
}

export async function removeWorkDependency(input: {
  dependencyId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ActionFailure | { success: true; version: number }> {
  const parsed = removeDependencyInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc('remove_work_dependency', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dependency_id: parsed.data.dependencyId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false as const, error: mapWorkError(error) };
  revalidateWork();
  return { success: true as const, version: data };
}
