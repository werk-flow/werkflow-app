'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { uuidSchema } from '@/lib/validation/uuid';
import { updateTag, revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { authenticateAndAuthorize } from './auth';
import {
  assessAssignmentSelection,
  assignmentReplacementArguments,
  type AssignmentContext,
  type AssignmentReplacement,
} from './assignment-assessment';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import {
  type Job,
  type JobStatus,
  type JobPriority,
  type JobRow,
  type JobWithDetails,
  type JobAssignmentWithProfile,
  type ProjectWithDetails,
  type CalendarJob,
  type CreateJobResult,
  type UpdateJobResult,
  type DeleteJobResult,
  type UpdateJobAssignmentsResult,
  normalizeJobPlannedTime,
  getJobDisplayTitle,
  toJob,
  toClient,
  toProject,
  toJobAssignment,
} from './types';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import { toClientContact, toClientSite, type ClientContact, type ClientSite } from '@/lib/clients/types';
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

export type AuftraegeDialogOptionsResult =
  | {
      success: true;
      clients: ReturnType<typeof toClient>[];
      members: Array<{
        userId: string;
        firstName: string;
        lastName: string;
        role: string;
      }>;
      projects: ProjectWithDetails[];
      jobs: Job[];
    }
  | ActionFailure;

export async function getAuftraegeDialogOptions(): Promise<AuftraegeDialogOptionsResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const [clientsResult, membersResult, projectsResult, jobsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('clients')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .order('name', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin.rpc('get_org_members_for_user', {
      p_org_id: auth.context.orgId,
      p_user_id: auth.context.userId,
    }),
    readCompleteRows(
      (from, to) =>
        admin
          .from('projects')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .order('planned_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);

  if (clientsResult.error) {
    logReadErrors('job dialog options: read failed', clientsResult.error);
    return { success: false, error: 'clients_failed' };
  }
  if (membersResult.error) {
    logReadErrors('job dialog options: read failed', membersResult.error);
    return { success: false, error: 'members_failed' };
  }
  if (projectsResult.error) {
    logReadErrors('job dialog options: read failed', projectsResult.error);
    return { success: false, error: 'projects_failed' };
  }
  if (jobsResult.error) {
    logReadErrors('job dialog options: read failed', jobsResult.error);
    return { success: false, error: 'jobs_failed' };
  }

  const clients = (clientsResult.data ?? []).map(toClient);
  const clientLookup = new Map(clients.map((client) => [client.id, client]));
  const projectJobCounts = new Map<
    string,
    { total: number; completed: number; inProgress: number; parked: number }
  >();

  for (const job of jobsResult.data ?? []) {
    if (!job.project_id) continue;
    const counts = projectJobCounts.get(job.project_id) ?? {
      total: 0,
      completed: 0,
      inProgress: 0,
      parked: 0,
    };
    counts.total++;
    if (job.status === 'fertig') counts.completed++;
    if (job.status === 'in_bearbeitung') counts.inProgress++;
    if (job.status === 'geparkt') counts.parked++;
    projectJobCounts.set(job.project_id, counts);
  }

  return {
    success: true,
    clients,
    members: (membersResult.data ?? []).map(
      (member: { user_id: string; first_name: string | null; last_name: string | null; role: string }) => ({
        userId: member.user_id,
        firstName: member.first_name ?? '',
        lastName: member.last_name ?? '',
        role: member.role,
      }),
    ),
    projects: (projectsResult.data ?? []).map((row) => {
      const project = toProject(row);
      const counts = projectJobCounts.get(project.id) ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
        parked: 0,
      };

      return {
        ...project,
        client: project.clientId ? (clientLookup.get(project.clientId) ?? null) : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
        inProgressJobCount: counts.inProgress,
        parkedJobCount: counts.parked,
      };
    }),
    jobs: (jobsResult.data ?? []).map(toJob),
  };
}

// Site/contact context for the job detail surfaces (office and assigned
// field workers alike). Null when a read failed: a missing site or contact
// would look like none.
async function loadJobSiteAndContact(
  admin: AdminClient,
  orgId: string,
  siteId: string | null,
  contactId: string | null,
): Promise<{ site: ClientSite | null; contact: ClientContact | null } | null> {
  const [siteResult, contactResult] = await Promise.all([
    siteId
      ? admin.from('client_sites').select('*').eq('organization_id', orgId).eq('id', siteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactId
      ? admin
          .from('client_contacts')
          .select('*')
          .eq('organization_id', orgId)
          .eq('id', contactId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const error = siteResult.error ?? contactResult.error;
  if (error) {
    logReadFailure('loadJobSiteAndContact: site or contact failed', error);
    return null;
  }

  return {
    site: siteResult.data ? toClientSite(siteResult.data) : null,
    contact: contactResult.data ? toClientContact(contactResult.data) : null,
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
    const prepared = await prepareJobUpdate({ admin, orgId, actorId: auth.context.userId, jobId, input });
    if (!prepared.success) return prepared;
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

type JobPlanOrderRow = Pick<JobRow, 'planned_date' | 'created_at' | 'id'>;

/** The job list order (planned date, newest first, id), restored after a batched read. */
function compareJobRowsByPlan(left: JobPlanOrderRow, right: JobPlanOrderRow): number {
  if (left.planned_date !== right.planned_date) {
    if (left.planned_date === null) return 1;
    if (right.planned_date === null) return -1;
    return left.planned_date < right.planned_date ? -1 : 1;
  }
  return right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id);
}

/**
 * The shared tail of the job detail readers: an employee reads only a job they
 * are assigned to; the job comes back with its assignees, customer, project,
 * site and contact.
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
    const { data: assignment, error: assignmentError } = await loggedRead(
      `${input.operation}: job_assignments read failed`,
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_id', jobData.id)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (assignmentError) return { success: false, error: 'load_failed' };

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
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
  const assignmentRows = assignmentRowsResult.data;
  const assignments: JobAssignmentWithProfile[] = [];
  if (assignmentRows.length > 0) {
    const userIds = assignmentRows.map((a) => a.user_id);
    const { data: profiles, error: profilesError } = await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...batch]),
    );
    if (profilesError) {
      logReadFailure(`${input.operation}: assignee profiles failed`, profilesError);
      return { success: false, error: 'fetch_failed' };
    }

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    for (const row of assignmentRows) {
      const profile = profileMap.get(row.user_id);
      assignments.push({
        ...toJobAssignment(row),
        firstName: profile?.first_name ?? null,
        lastName: profile?.last_name ?? null,
        email: profile?.email ?? null,
        avatarPath: profile?.avatar_path ?? null,
      });
    }
  }

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

  const siteAndContact = await loadJobSiteAndContact(admin, orgId, jobData.site_id, jobData.contact_id);
  if (!siteAndContact) return { success: false, error: 'fetch_failed' };
  const { site, contact } = siteAndContact;

  const job: JobWithDetails = {
    ...toJob({ ...jobData, client_id: effectiveClientId }),
    assignments,
    client,
    project,
    site,
    contact,
  };

  return { success: true, job };
}

export async function getJobDetails(rawJobId: string): Promise<ActionResult<{ job: JobWithDetails }>> {
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

    return await readJobDetails({ admin, context: auth.context, jobData, operation: 'getJobDetails' });
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

    return { success: true, jobNumber: data as string };
  } catch (error) {
    logError('Unexpected error in getNextJobNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Client-scoped queries
// ============================================

export type ClientJobsResult = {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
};

/**
 * Fetch all jobs and projects associated with a specific client.
 * Includes jobs directly linked to the client AND jobs belonging to
 * projects linked to the client. Requires admin/manager access.
 */
export async function getJobsForClient(rawClientId: string): Promise<ActionResult<ClientJobsResult>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'invalid_client' };
  const clientId = parsedClientId.data;
  const admin = createSupabaseAdminClient();
  const [directJobs, clientProjects] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('*')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('projects')
          .select('*')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (directJobs.error || clientProjects.error) {
    logReadErrors('getJobsForClient: read failed', directJobs.error, clientProjects.error);
    return { success: false, error: 'fetch_failed' };
  }
  const projectIds = [
    ...new Set([
      ...clientProjects.data.map((project) => project.id),
      ...directJobs.data.flatMap((job) => (job.project_id ? [job.project_id] : [])),
    ]),
  ];
  const [allProjects, projectJobs] = await Promise.all([
    readInBatches(projectIds, (ids) =>
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(projectIds, (ids) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('jobs')
            .select('*')
            .eq('organization_id', orgId)
            .in('project_id', [...ids])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (allProjects.error || projectJobs.error || projectJobs.data.length > LIST_ROW_CAP) {
    logReadErrors('getJobsForClient: read failed', allProjects.error, projectJobs.error);
    return { success: false, error: 'fetch_failed' };
  }
  const directProjectIds = new Set(clientProjects.data.map((project) => project.id));
  const jobRows = new Map(directJobs.data.map((job) => [job.id, job]));
  for (const job of projectJobs.data)
    if (job.project_id && directProjectIds.has(job.project_id)) jobRows.set(job.id, job);
  const jobs = [...jobRows.values()].map(toJob);
  if (jobs.length > LIST_ROW_CAP) return { success: false, error: 'fetch_failed' };
  const clientIds = [
    ...new Set(
      [...allProjects.data, ...jobRows.values()].flatMap((row) => (row.client_id ? [row.client_id] : [])),
    ),
  ];
  const [clients, assignments] = await Promise.all([
    readInBatches(clientIds, (ids) =>
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(
      jobs.map((job) => job.id),
      (ids) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('job_assignments')
              .select('job_id,user_id')
              .eq('organization_id', orgId)
              .in('job_id', [...ids])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
    ),
  ]);
  if (clients.error || assignments.error || assignments.data.length > LIST_ROW_CAP * 4) {
    logReadErrors('getJobsForClient: read failed', clients.error, assignments.error);
    return { success: false, error: 'fetch_failed' };
  }
  const clientLookup = new Map(clients.data.map((client) => [client.id, toClient(client)]));
  const projects: ProjectWithDetails[] = allProjects.data.map((project) => {
    const children = projectJobs.data.filter((job) => job.project_id === project.id);
    return {
      ...toProject(project),
      client: project.client_id ? (clientLookup.get(project.client_id) ?? null) : null,
      jobCount: children.length,
      completedJobCount: children.filter((job) => job.status === 'fertig').length,
      inProgressJobCount: children.filter((job) => job.status === 'in_bearbeitung').length,
      parkedJobCount: children.filter((job) => job.status === 'geparkt').length,
    };
  });
  const jobAssignmentMap: Record<string, string[]> = {};
  for (const assignment of assignments.data)
    (jobAssignmentMap[assignment.job_id] ??= []).push(assignment.user_id);
  return {
    success: true,
    jobs,
    projects,
    clientMap: Object.fromEntries(clients.data.map((client) => [client.id, client.name])),
    jobAssignmentMap,
  };
}
// ============================================
// Member-scoped queries
// ============================================

export type MemberJobsResult = {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
};

/**
 * Fetch all jobs assigned to a specific member, along with their parent
 * projects, client names, and the full assignment map for those jobs.
 * Requires admin/manager access.
 */
export async function getJobsForMember(rawMemberId: string): Promise<ActionResult<MemberJobsResult>> {
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

    const { data: assignments, error: assignError } = await readCompleteRows(
      (from, to) =>
        admin
          .from('job_assignments')
          .select('job_id')
          .eq('organization_id', orgId)
          .eq('user_id', memberId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );

    if (assignError) {
      logError('Error fetching member assignments:', assignError);
      return { success: false, error: 'fetch_failed' };
    }

    const assignedJobIds = [...new Set(assignments.map((a) => a.job_id))];

    if (assignedJobIds.length === 0) {
      return {
        success: true,
        jobs: [],
        projects: [],
        clientMap: {},
        jobAssignmentMap: {},
      };
    }

    const { data: jobRows, error: jobError } = await readInBatches(assignedJobIds, (batch) =>
      admin
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    );

    if (jobError) {
      logError('Error fetching member jobs:', jobError);
      return { success: false, error: 'fetch_failed' };
    }

    const jobs = jobRows.sort(compareJobRowsByPlan).map(toJob);
    const projectIds = jobs.flatMap((job) => (job.projectId ? [job.projectId] : []));
    const [projectRows, projectJobs, allAssignments] = await Promise.all([
      readInBatches(projectIds, (batch) =>
        admin
          .from('projects')
          .select('*')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
      ),
      readInBatches(projectIds, (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('jobs')
              .select('id, project_id, status')
              .eq('organization_id', orgId)
              .in('project_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
      ),
      readInBatches(assignedJobIds, (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('job_assignments')
              .select('job_id, user_id')
              .eq('organization_id', orgId)
              .in('job_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
      ),
    ]);
    const clientIds = [...projectRows.data, ...jobRows].flatMap((row) =>
      row.client_id ? [row.client_id] : [],
    );
    const clientRows = await readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    );
    const relatedError = projectRows.error ?? projectJobs.error ?? allAssignments.error ?? clientRows.error;
    if (relatedError) {
      logError('Error fetching member job details:', relatedError);
      return { success: false, error: 'fetch_failed' };
    }

    const jobsByProject = new Map<
      string,
      { total: number; completed: number; inProgress: number; parked: number }
    >();
    for (const projectJob of projectJobs.data) {
      if (!projectJob.project_id) continue;
      const entry = jobsByProject.get(projectJob.project_id) ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
        parked: 0,
      };
      entry.total++;
      if (projectJob.status === 'fertig') entry.completed++;
      if (projectJob.status === 'in_bearbeitung') entry.inProgress++;
      if (projectJob.status === 'geparkt') entry.parked++;
      jobsByProject.set(projectJob.project_id, entry);
    }
    const clientLookup = new Map(clientRows.data.map((client) => [client.id, client]));
    const projects: ProjectWithDetails[] = projectRows.data.map((row) => {
      const counts = jobsByProject.get(row.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
      const client = row.client_id ? clientLookup.get(row.client_id) : undefined;
      return {
        ...toProject(row),
        client: client ? toClient(client) : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
        inProgressJobCount: counts.inProgress,
        parkedJobCount: counts.parked,
      };
    });

    const jobAssignmentMap: Record<string, string[]> = {};
    for (const a of allAssignments.data) {
      (jobAssignmentMap[a.job_id] ??= []).push(a.user_id);
    }

    return {
      success: true,
      jobs,
      projects,
      clientMap: Object.fromEntries(clientRows.data.map((client) => [client.id, client.name])),
      jobAssignmentMap,
    };
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

    const parkedJobColumns =
      'id, title, description, job_number, status, priority, planned_date, planned_time, estimated_duration_minutes, planned_working_minutes, location, client_id, project_id, updated_at, execution_version, execution_state';
    let parkedJobs;
    if (isManagerOrAbove) {
      parkedJobs = await readCompleteRows(
        (from, to) =>
          admin
            .from('jobs')
            .select(parkedJobColumns)
            .eq('organization_id', orgId)
            .eq('status', 'geparkt')
            .order('updated_at', { ascending: true })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      );
    } else {
      const assignments = await readCompleteRows(
        (from, to) =>
          admin
            .from('job_assignments')
            .select('job_id')
            .eq('organization_id', orgId)
            .eq('user_id', userId)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      );
      if (assignments.error) {
        logError('Error fetching parked job assignments:', assignments.error);
        return { success: false, error: 'fetch_failed' };
      }
      parkedJobs = await readInBatches(
        assignments.data.map((a) => a.job_id),
        (batch) =>
          admin
            .from('jobs')
            .select(parkedJobColumns)
            .eq('organization_id', orgId)
            .eq('status', 'geparkt')
            .in('id', [...batch]),
      );
      parkedJobs.data.sort(
        (left, right) => left.updated_at.localeCompare(right.updated_at) || left.id.localeCompare(right.id),
      );
    }

    const { data: jobs, error: jobsError } = parkedJobs;

    if (jobsError) {
      logError('Error fetching parked jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    if (jobs.length === 0) {
      return { success: true, jobs: [] };
    }

    const jobIds = jobs.map((j) => j.id);
    const clientIds = jobs.map((j) => j.client_id).filter((id): id is string => id !== null);
    const projectIds = jobs.map((j) => j.project_id).filter((id): id is string => id !== null);

    const [assignmentsResult, clientsResult, projectsResult] = await Promise.all([
      readInBatches(jobIds, (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('job_assignments')
              .select('job_id, user_id')
              .eq('organization_id', orgId)
              .in('job_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
      ),
      readInBatches(clientIds, (batch) =>
        admin
          .from('clients')
          .select('id, name, address')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
      ),
      readInBatches(projectIds, (batch) =>
        admin
          .from('projects')
          .select('id, name, project_number')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
      ),
    ]);
    const relatedError = assignmentsResult.error ?? clientsResult.error ?? projectsResult.error;
    if (relatedError) {
      logError('Error fetching parked job details:', relatedError);
      return { success: false, error: 'fetch_failed' };
    }

    const assignmentMap: Record<string, string[]> = {};
    for (const a of assignmentsResult.data || []) {
      (assignmentMap[a.job_id] ??= []).push(a.user_id);
    }

    const clientMap: Record<string, { name: string; address: string | null }> = {};
    for (const c of clientsResult.data || []) {
      clientMap[c.id] = {
        name: c.name,
        address: c.address,
      };
    }

    const projectMap: Record<string, { name: string; number: string | null }> = {};
    for (const p of projectsResult.data || []) {
      projectMap[p.id] = { name: p.name, number: p.project_number };
    }

    const calendarJobs: CalendarJob[] = jobs.map((j) => ({
      id: j.id,
      jobNumber: j.job_number,
      title: getJobDisplayTitle({
        title: j.title,
        description: j.description,
      }),
      status: j.status as JobStatus,
      executionVersion: j.execution_version ?? 0,
      executionState: j.execution_state,
      priority: j.priority as JobPriority,
      plannedDate: j.planned_date,
      plannedTime: normalizeJobPlannedTime(j.planned_time),
      estimatedDurationMinutes: j.estimated_duration_minutes,
      plannedWorkingMinutes: j.planned_working_minutes,
      location: j.location,
      clientName: j.client_id ? (clientMap[j.client_id]?.name ?? null) : null,
      clientAddress: j.client_id ? (clientMap[j.client_id]?.address ?? null) : null,
      projectName: j.project_id ? (projectMap[j.project_id]?.name ?? null) : null,
      projectNumber: j.project_id ? (projectMap[j.project_id]?.number ?? null) : null,
      assignedUserIds: assignmentMap[j.id] || [],
    }));

    return { success: true, jobs: calendarJobs };
  } catch (error) {
    logError('Unexpected error in getParkedJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
