'use server';

import type { ActionResult } from '@/lib/action-result';
import { uuidSchema } from '@/lib/validation/uuid';
import { updateTag, revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
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
import { CUSTOMER_REFERENCE_REFUSALS, workWriteFailure } from './write-refusals';
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

async function replaceJobAssignmentsAfterAssessment(
  input: AssignmentReplacement & { context: AssignmentContext; jobId: string },
): Promise<ActionResult<{ assignments: ReturnType<typeof toJobAssignment>[] }>> {
  const replacement = assignmentReplacementArguments(input);
  const selectedUserIds = replacement.p_selected_user_ids;
  const { error: replaceError } = await input.context.admin.rpc(
    'replace_job_assignments_with_assessment',
    rpcArgs('replace_job_assignments_with_assessment', {
      ...replacement,
      p_organization_id: input.context.orgId,
      p_job_id: input.jobId,
      p_actor_id: input.context.actorId,
    }),
  );
  if (replaceError) {
    logError('Failed to replace job assignments:', replaceError);
    return { success: false, error: 'assign_failed' };
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

    // One transaction: the job, its assignments and its work template, or nothing.
    const { data, error } = await admin.rpc(
      'create_job_with_assignments',
      rpcArgs('create_job_with_assignments', {
        ...prepared.arguments,
        p_organization_id: orgId,
        p_actor_id: userId,
      }),
    );
    if (error) return workWriteFailure('Error creating job:', error, JOB_CREATION_REFUSALS, 'create_failed');

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
    // tenant-scope: built-from-context — prepareJobUpdate sets p_organization_id from the orgId passed above, which authenticateAndAuthorize resolved.
    const { data, error } = await admin.rpc('update_job_with_assignments', prepared.arguments);

    if (error) {
      return workWriteFailure('Error updating job:', error, JOB_UPDATE_REFUSALS, 'update_failed');
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

    const { error } = await admin.from('jobs').delete().eq('id', jobId).eq('organization_id', orgId);

    if (error) {
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
): Promise<UpdateJobAssignmentsResult> {
  const parsedArguments = updateJobAssignmentsArgumentsSchema.safeParse({
    jobId: rawJobId,
    selectedUserIds: rawSelectedUserIds,
    approval: rawApproval,
    teamSourceId: rawTeamSourceId,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { jobId, selectedUserIds, approval, teamSourceId } = parsedArguments.data;
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
    const result = await replaceJobAssignmentsAfterAssessment({
      context,
      jobId,
      selectedUserIds: normalizedUserIds,
      evaluation: assessment.evaluation,
      approval,
      teamSourceId,
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

/**
 * The shared tail of the job detail readers: an employee reads only a job they
 * are assigned to; the job comes back with its assignees, customer, project,
 * site and contact, for an employee in the field projection.
 */
async function readJobDetails(input: {
  admin: AdminClient;
  context: { userId: string; orgId: string; isManagerOrAbove: boolean };
  jobData: JobRow;
  operation: string;
}): Promise<ActionResult<{ job: JobWithDetails }>> {
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
  const { data: clientData, error: clientError } = effectiveClientId
    ? await admin
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .eq('id', effectiveClientId)
        .maybeSingle()
    : { data: null, error: null };
  if (clientError) {
    logReadFailure(`${input.operation}: client failed`, clientError);
    return { success: false, error: 'fetch_failed' };
  }

  const client = clientData ? toClient(clientData) : null;
  const project = projectData
    ? {
        id: projectData.id,
        name: projectData.name,
        projectNumber: projectData.project_number,
      }
    : null;

  const relations = await loadJobDetailRelations(admin, orgId, jobData);
  if (!relations) return { success: false, error: 'fetch_failed' };

  const job: JobWithDetails = {
    ...toJob({ ...jobData, client_id: effectiveClientId }),
    assignments,
    client,
    project,
    ...relations,
  };

  return { success: true, job: isManagerOrAbove ? job : projectFieldJobDetails(job) };
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

export async function getJobByNumber(rawJobNumber: string): Promise<ActionResult<{ job: JobWithDetails }>> {
  const parsedJobNumber = jobNumberLookupSchema.safeParse(rawJobNumber);
  if (!parsedJobNumber.success) return { success: false, error: 'job_not_found' };
  const jobNumber = parsedJobNumber.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: jobData, error: jobError } = await admin
      .from('jobs')
      .select('*')
      .eq('organization_id', orgId)
      .eq('job_number', decodeURIComponent(jobNumber))
      .single();

    if (jobError || !jobData) {
      logReadErrors('getJobByNumber: read failed', jobError);
      return { success: false, error: 'job_not_found' };
    }

    return await readJobDetails({ admin, context: auth.context, jobData, operation: 'getJobByNumber' });
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
