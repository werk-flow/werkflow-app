'use server';

import {
  hasMaterialHistory,
  isMaterialHistoryRefusal,
  MATERIAL_HISTORY_EXISTS,
} from '@/lib/inventory/material-history';
import type { ActionResult } from '@/lib/action-result';
import { uuidSchema } from '@/lib/validation/uuid';
import { updateTag, revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  assessJobPlan,
  assessJobTeamChange,
  assessNewJobPlan,
  type JobVisitAssessment,
} from '@/lib/planning/job-team-assessment';
import {
  planningAcknowledgement,
  type PlanningConflictApproval,
} from '@/lib/planning/conflict-acknowledgement';
import { authenticateAndAuthorize } from './auth';
import { readJobAssignmentOfUser } from './job-access-reads';
import {
  assessAssignmentSelection,
  assignmentReplacementArguments,
  type AssignmentContext,
  type AssignmentReplacement,
} from './assignment-assessment';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import {
  type Client,
  type JobPriority,
  type JobRow,
  type JobWithDetails,
  type CalendarJob,
  type CreateJobResult,
  type UpdateJobResult,
  type DeleteJobResult,
  type UpdateJobAssignmentsResult,
  toJob,
  toClient,
  toJobAssignment,
} from './types';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import { JOB_BILLING_PARTIES_EMBED, jobBillingPartiesFrom } from '@/lib/billing-parties/server';
import type { WorkBillingParties } from '@/lib/billing-parties/types';
import {
  loadJobDetailRelations,
  readJobAssigneeProfiles,
  readJobVisitPlan,
  refuseScheduleOfSeveralVisits,
} from './job-detail-reads';
import { readParkedCalendarJobs } from './parked-job-reads';
import { readJobsOfClient, readJobsOfMember, type RelatedJobs } from './related-job-reads';
import { projectFieldJobDetails } from './field-work-pack';
import type { JobVisitPlan } from './visit-schedule';
import { logError } from '@/lib/logging';
import { timeWriteFailure } from '@/lib/time-tracking/closed-periods';
import { CUSTOMER_REFERENCE_REFUSALS, jobPlanWriteFailure } from './write-refusals';
import { prepareJobUpdate } from './update-preparation';
import { JOB_CREATION_REFUSALS, prepareJobCreation } from './creation';
import {
  createJobInputSchema,
  jobNumberLookupSchema,
  MAX_JOB_ASSIGNMENTS,
  updateJobArgumentsSchema,
  updateJobAssignmentsArgumentsSchema,
} from './action-schemas';

// ============================================
// Input Types
// ============================================

export type CreateJobInput = {
  title: string;
  description?: string;
  clientId?: string;
  projectId?: string;
  jobNumber?: string;
  priority?: JobPriority;
  plannedDate?: string;
  plannedTime?: string;
  estimatedDurationMinutes?: number;
  plannedWorkingMinutes?: number | null;
  location?: string;
  siteId?: string;
  contactId?: string;
  selectedUserIds?: string[];
  assignmentApproval?: AssignmentApproval | null;
  assignmentTeamSourceId?: string | null;
  templateVersionId?: string;
  /** The reason for the planning conflicts of the visit the save plans, for the assessment the manager saw. */
  planningApproval?: PlanningConflictApproval | null;
};

export type UpdateJobInput = Omit<
  Partial<CreateJobInput>,
  'plannedDate' | 'plannedTime' | 'estimatedDurationMinutes'
> & {
  jobNumber?: string;
  plannedDate?: string | null;
  plannedTime?: string | null;
  estimatedDurationMinutes?: number | null;
  plannedWorkingMinutes?: number | null;
};

// A refused assignment inside update_job_with_assignments falls back to
// update_failed: nothing of the edit was saved.
const JOB_UPDATE_REFUSALS = [
  'job_not_found',
  'title_or_description_required',
  'project_not_found',
  'job_number_taken',
  ...CUSTOMER_REFERENCE_REFUSALS,
];

/**
 * Replaces the job team with its qualification assessment and, when the
 * change adds people to the job's unstarted visit, records that visit's
 * capacity assessment in the same call.
 */
async function replaceJobAssignmentsAfterAssessment(
  input: AssignmentReplacement & {
    context: AssignmentContext;
    jobId: string;
    expectedUserIds: string[];
    visitAssessment: JobVisitAssessment | null;
  },
): Promise<ActionResult<{ assignments: ReturnType<typeof toJobAssignment>[] }>> {
  const replacement = assignmentReplacementArguments(input);
  const selectedUserIds = replacement.p_selected_user_ids;
  const visit = input.visitAssessment;
  const { error: replaceError } = await input.context.admin.rpc(
    'replace_job_assignments_with_visit_assessment',
    rpcArgs('replace_job_assignments_with_visit_assessment', {
      ...replacement,
      p_organization_id: input.context.orgId,
      p_job_id: input.jobId,
      p_actor_id: input.context.actorId,
      p_expected_user_ids: input.expectedUserIds,
      p_visit_id: visit?.visitId ?? null,
      p_visit_version: visit?.visitVersion ?? null,
      p_capacity_snapshot: visit?.capacitySnapshot ?? null,
      p_capacity_fingerprint: visit?.capacityFingerprint ?? null,
      p_qualification_snapshot: visit?.qualificationSnapshot ?? null,
      p_qualification_fingerprint: visit?.qualificationFingerprint ?? null,
      p_planning_override_reason: visit?.overrideReason ?? null,
    }),
  );
  if (replaceError) {
    logError('Failed to replace job assignments:', replaceError);
    // The team or the visit changed after the server assessed them: save again on the new state.
    const stale = [
      'stale_job_assignments',
      'stale_planning_occurrence',
      'planning_occurrence_not_found',
    ].some((code) => replaceError.message.includes(code));
    return { success: false, error: stale ? 'assignments_changed' : 'assign_failed' };
  }
  const { data: assignmentRows, error: loadError } = await input.context.admin
    .from('job_assignments')
    .select('*')
    .eq('organization_id', input.context.orgId)
    .eq('job_id', input.jobId)
    .order('assigned_at', { ascending: true });
  if (loadError) {
    logError('Failed to reload job assignments:', loadError);
    return { success: false, error: 'load_failed' };
  }
  const rowsByUserId = new Map((assignmentRows ?? []).map((row) => [row.user_id, row]));
  return {
    success: true,
    assignments: selectedUserIds.flatMap((userId) => {
      const row = rowsByUserId.get(userId);
      return row ? [toJobAssignment(row)] : [];
    }),
  };
}

// ============================================
// Actions
// ============================================

export async function createJob(rawInput: CreateJobInput): Promise<CreateJobResult> {
  const parsedInput = createJobInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const prepared = await prepareJobCreation(
      { admin, orgId, actorId: userId },
      input,
      input.jobNumber ?? '',
    );
    if (!prepared.success) return prepared;
    // The calendar's capacity check of the visit the new job plans with its people.
    const plan = await assessNewJobPlan({ admin, orgId, job: input });
    if (!plan.success) return plan;

    // One transaction: the job, its assignments, its work template and its visit's assessment, or nothing.
    const { data, error } = await admin.rpc(
      'create_job_with_visit_assessment',
      rpcArgs('create_job_with_visit_assessment', {
        ...prepared.arguments,
        p_organization_id: orgId,
        p_actor_id: userId,
        p_visit_assessment: plan.planAssessment,
      }),
    );
    if (error)
      return jobPlanWriteFailure('Error creating job:', error, JOB_CREATION_REFUSALS, 'create_failed');

    updateTag(CACHE_TAGS.workTemplates(orgId));

    return { success: true, job: toJob(data) };
  } catch (error) {
    logError('Unexpected error in createJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateJob(rawJobId: string, rawInput: UpdateJobInput): Promise<UpdateJobResult> {
  const parsedArguments = updateJobArgumentsSchema.safeParse({ jobId: rawJobId, input: rawInput });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { jobId, input } = parsedArguments.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const scheduleRefusal = await refuseScheduleOfSeveralVisits({ admin, orgId, jobId, changes: input });
    if (scheduleRefusal) return scheduleRefusal;
    const prepared = await prepareJobUpdate({ admin, orgId, actorId: auth.context.userId, jobId, input });
    if (!prepared.success) return prepared;
    // The calendar's capacity check of the visit the edit moves or adds people to.
    const plan = await assessJobPlan({
      admin,
      orgId,
      jobId,
      ...prepared.plan,
      acknowledgement: planningAcknowledgement(input.planningApproval),
    });
    if (!plan.success) return plan;
    // tenant-scope: built-from-context — prepareJobUpdate sets p_organization_id from the orgId passed above, which authenticateAndAuthorize resolved.
    const { data, error } = await admin.rpc(
      'update_job_with_visit_assessment',
      rpcArgs('update_job_with_visit_assessment', {
        ...prepared.arguments,
        p_visit_assessment: plan.planAssessment,
      }),
    );

    if (error) {
      return jobPlanWriteFailure('Error updating job:', error, JOB_UPDATE_REFUSALS, 'update_failed');
    }

    revalidatePath('/auftraege', 'layout');

    return { success: true, job: toJob(data) };
  } catch (error) {
    logError('Unexpected error in updateJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteJob(rawJobId: string): Promise<DeleteJobResult> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'job_not_found' };
  const jobId = parsedJobId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('jobs')
      .select('id, project_id')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'job_not_found' };
    }

    const { count: planningOccurrenceCount, error: planningCheckError } = await admin
      .from('planning_occurrences')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('job_id', jobId);

    if (planningCheckError) {
      logError('Error checking job planning history:', planningCheckError);
      return { success: false, error: 'delete_failed' };
    }
    if ((planningOccurrenceCount ?? 0) > 0) {
      return { success: false, error: 'planning_history_exists' };
    }

    const materialHistory = await hasMaterialHistory(admin, orgId, { jobId });
    if (materialHistory.error) return { success: false, error: 'delete_failed' };
    if (materialHistory.exists) return { success: false, error: MATERIAL_HISTORY_EXISTS };

    const { error } = await admin.from('jobs').delete().eq('id', jobId).eq('organization_id', orgId);

    if (error) {
      // A take booked after the check: the ledger keeps it, so the delete is refused.
      if (isMaterialHistoryRefusal(error)) return { success: false, error: MATERIAL_HISTORY_EXISTS };
      // Deleting a job clears time_entries.job_id; a closed period refuses that write.
      return { success: false, error: timeWriteFailure('Error deleting job:', error, 'delete_failed') };
    }

    revalidatePath('/auftraege', 'layout');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateJobAssignments(
  rawJobId: string,
  rawSelectedUserIds: string[],
  rawApproval?: AssignmentApproval | null,
  rawTeamSourceId?: string | null,
  rawPlanningApproval?: PlanningConflictApproval | null,
): Promise<UpdateJobAssignmentsResult> {
  const parsedArguments = updateJobAssignmentsArgumentsSchema.safeParse({
    jobId: rawJobId,
    selectedUserIds: rawSelectedUserIds,
    approval: rawApproval,
    teamSourceId: rawTeamSourceId,
    planningApproval: rawPlanningApproval,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { jobId, selectedUserIds, approval, teamSourceId, planningApproval } = parsedArguments.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }
    const normalizedUserIds = [...new Set(selectedUserIds)];
    if (normalizedUserIds.length > MAX_JOB_ASSIGNMENTS) {
      return { success: false, error: 'invalid_input' };
    }
    const admin = createSupabaseAdminClient();
    const { data: job, error } = await admin
      .from('jobs')
      .select('id, planned_date')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();
    if (error || !job) return { success: false, error: 'job_not_found' };
    const context = { admin, orgId, actorId: userId };
    const assessment = await assessAssignmentSelection({
      context,
      jobId,
      selectedUserIds: normalizedUserIds,
      assessedForDate: job.planned_date,
      approval,
    });
    if (!assessment.success) return assessment;
    // The capacity check of the calendar: a person added here reaches the
    // job's unstarted visit, so a conflict there needs a confirmed reason.
    const teamAssessment = await assessJobTeamChange({
      admin,
      orgId,
      jobId,
      nextUserIds: normalizedUserIds,
      acknowledgement: {
        overrideReason: planningApproval?.reason ?? null,
        assessmentFingerprint: planningApproval?.fingerprint ?? null,
      },
    });
    if (!teamAssessment.success) return teamAssessment;
    const result = await replaceJobAssignmentsAfterAssessment({
      context,
      jobId,
      selectedUserIds: normalizedUserIds,
      evaluation: assessment.evaluation,
      approval,
      teamSourceId,
      expectedUserIds: teamAssessment.currentUserIds,
      visitAssessment: teamAssessment.visitAssessment,
    });
    if (!result.success) return result;
    revalidatePath('/auftraege', 'layout');
    revalidatePath('/mitarbeiter', 'layout');
    return result;
  } catch (error) {
    logError('Unexpected error in updateJobAssignments:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** The job's customer, null without one; undefined when the read failed. */
async function readJobClient(
  admin: AdminClient,
  orgId: string,
  clientId: string | null,
  operation: string,
): Promise<Client | null | undefined> {
  if (!clientId) return null;
  const { data, error } = await admin
    .from('clients')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    logReadFailure(`${operation}: client failed`, error);
    return undefined;
  }
  return data ? toClient(data) : null;
}

/**
 * The shared tail of the job detail readers: an employee reads only a job they
 * are assigned to; the job comes back with its assignees, customer, project,
 * site and contact, for an employee in the field projection.
 */
async function readJobDetails(input: {
  admin: AdminClient;
  context: { userId: string; orgId: string; isManagerOrAbove: boolean };
  jobData: JobRow;
  /** The versions the job read embedded; undefined when it embedded none. */
  billingParties?: unknown;
  operation: string;
}): Promise<ActionResult<{ job: JobWithDetails; billingParties?: WorkBillingParties | undefined }>> {
  const { admin, jobData } = input;
  const { userId, orgId, isManagerOrAbove } = input.context;

  if (!isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
      orgId,
      jobData.id,
      userId,
    );
    if (assignmentError) return { success: false, error: 'load_failed' };
    if (!assignment) return { success: false, error: 'not_authorized' };
  }

  const [assignmentRowsResult, projectResult] = await Promise.all([
    admin.from('job_assignments').select('*').eq('organization_id', orgId).eq('job_id', jobData.id),
    jobData.project_id
      ? admin
          .from('projects')
          .select('id, name, project_number, client_id')
          .eq('organization_id', orgId)
          .eq('id', jobData.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectResult.error) {
    logReadFailure(`${input.operation}: project failed`, projectResult.error);
    return { success: false, error: 'fetch_failed' };
  }
  // A missing assignee list or missing names would show the job as unassigned or
  // every assignee as "Mitarbeiter", so either read failure fails the detail read.
  if (assignmentRowsResult.error) {
    logReadFailure(`${input.operation}: job_assignments failed`, { code: assignmentRowsResult.error.code });
    return { success: false, error: 'fetch_failed' };
  }
  const assignments = await readJobAssigneeProfiles(admin, assignmentRowsResult.data, input.operation);
  if (!assignments) return { success: false, error: 'fetch_failed' };

  const { data: projectData } = projectResult;
  const effectiveClientId = projectData ? projectData.client_id : jobData.client_id;
  const client = await readJobClient(admin, orgId, effectiveClientId, input.operation);
  if (client === undefined) return { success: false, error: 'fetch_failed' };
  const project = projectData
    ? {
        id: projectData.id,
        name: projectData.name,
        projectNumber: projectData.project_number,
      }
    : null;

  const loadedRelations = await loadJobDetailRelations(admin, orgId, jobData);
  if (!loadedRelations) return { success: false, error: 'fetch_failed' };
  const { siteContacts, ...relations } = loadedRelations;

  const job: JobWithDetails = {
    ...toJob({ ...jobData, client_id: effectiveClientId }),
    assignments,
    client,
    project,
    ...relations,
  };

  if (!isManagerOrAbove) return { success: true, job: projectFieldJobDetails(job) };
  // The office's billing parties ride on the reads above; a field worker never receives them.
  return {
    success: true,
    job,
    billingParties: officeBillingParties(input.billingParties, client, siteContacts),
  };
}

/**
 * The job read's embedded billing parties for the office, without the site the
 * job already carries; undefined when it embedded none or a malformed set.
 */
function officeBillingParties(
  embedded: unknown,
  client: Client | null,
  siteContacts: unknown,
): WorkBillingParties | undefined {
  if (embedded === undefined) return undefined;
  const workClient = client ? { id: client.id, name: client.name, address: client.address } : null;
  return jobBillingPartiesFrom({ workClient, versions: embedded, siteContacts }) ?? undefined;
}

/** The job form's reader: the job with its details and its scheduled visits. */
export async function getJobDetails(
  rawJobId: string,
): Promise<ActionResult<{ job: JobWithDetails; visits: JobVisitPlan }>> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'job_not_found' };
  const jobId = parsedJobId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: jobData, error: jobError } = await admin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (jobError || !jobData) {
      logReadErrors('getJobDetails: read failed', jobError);
      return { success: false, error: 'job_not_found' };
    }

    const [details, visits] = await Promise.all([
      readJobDetails({ admin, context: auth.context, jobData, operation: 'getJobDetails' }),
      readJobVisitPlan(admin, orgId, jobId),
    ]);
    if (!details.success) return details;
    return visits ? { ...details, visits } : { success: false, error: 'load_failed' };
  } catch (error) {
    logError('Unexpected error in getJobDetails:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getJobByNumber(
  rawJobNumber: string,
): Promise<ActionResult<{ job: JobWithDetails; billingParties?: WorkBillingParties | undefined }>> {
  const parsedJobNumber = jobNumberLookupSchema.safeParse(rawJobNumber);
  if (!parsedJobNumber.success) return { success: false, error: 'job_not_found' };
  const jobNumber = parsedJobNumber.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: jobRow, error: jobError } = await admin
      .from('jobs')
      .select(`*, ${JOB_BILLING_PARTIES_EMBED}`)
      .eq('organization_id', orgId)
      .eq('job_number', decodeURIComponent(jobNumber))
      .single();

    if (jobError || !jobRow) {
      logReadErrors('getJobByNumber: read failed', jobError);
      return { success: false, error: 'job_not_found' };
    }
    const { work_billing_parties: billingParties, ...jobData } = jobRow;

    return await readJobDetails({
      admin,
      context: auth.context,
      jobData,
      billingParties,
      operation: 'getJobByNumber',
    });
  } catch (error) {
    logError('Unexpected error in getJobByNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getNextJobNumber(): Promise<ActionResult<{ jobNumber: string }>> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_job_number', {
      p_org_id: orgId,
    });

    if (error || !data) {
      logError('Error generating job number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, jobNumber: data };
  } catch (error) {
    logError('Unexpected error in getNextJobNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Fetch all jobs and projects associated with a specific client.
 * Includes jobs directly linked to the client AND jobs belonging to
 * projects linked to the client. Requires admin/manager access.
 */
export async function getJobsForClient(rawClientId: string): Promise<ActionResult<RelatedJobs>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'invalid_client' };
  const clientId = parsedClientId.data;
  const admin = createSupabaseAdminClient();
  return readJobsOfClient(admin, orgId, clientId);
}

/**
 * Fetch all jobs assigned to a specific member, along with their parent
 * projects, client names, and the full assignment map for those jobs.
 * Requires admin/manager access.
 */
export async function getJobsForMember(rawMemberId: string): Promise<ActionResult<RelatedJobs>> {
  const parsedMemberId = uuidSchema.safeParse(rawMemberId);
  if (!parsedMemberId.success) return { success: false, error: 'invalid_input' };
  const memberId = parsedMemberId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    return await readJobsOfMember(admin, orgId, memberId);
  } catch (error) {
    logError('Unexpected error in getJobsForMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Fetch parked jobs — those with status = 'geparkt'.
 * Admin/manager see all org jobs; others see only their assigned jobs.
 */
export async function getParkedJobs(): Promise<ActionResult<{ jobs: CalendarJob[] }>> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();
    return await readParkedCalendarJobs(admin, { orgId, userId, isManagerOrAbove });
  } catch (error) {
    logError('Unexpected error in getParkedJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
