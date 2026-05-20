'use server';

import { updateTag, revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from './auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import {
  type Job,
  type JobStatus,
  type JobPriority,
  type JobWithDetails,
  type JobAssignmentWithProfile,
  type ProjectWithDetails,
  type CalendarJob,
  type CreateJobResult,
  type UpdateJobResult,
  type DeleteJobResult,
  type AssignEmployeeResult,
  type UnassignEmployeeResult,
  normalizeJobPlannedTime,
  toJob,
  toClient,
  toProject,
  toJobAssignment,
} from './types';

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
};

export type UpdateJobInput = Omit<Partial<CreateJobInput>, 'plannedDate' | 'plannedTime' | 'estimatedDurationMinutes'> & {
  jobNumber?: string;
  plannedDate?: string | null;
  plannedTime?: string | null;
  estimatedDurationMinutes?: number | null;
  plannedWorkingMinutes?: number | null;
};

type ProjectClientContext = {
  id: string;
  client_id: string | null;
};

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
  | { success: false; error: string };

export async function getAuftraegeDialogOptions(): Promise<AuftraegeDialogOptionsResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const [clientsResult, membersResult, projectsResult, jobsResult] =
    await Promise.all([
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .order('name', { ascending: true }),
      admin.rpc('get_org_members_for_user', {
        p_org_id: auth.context.orgId,
        p_user_id: auth.context.userId
      }),
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .order('created_at', { ascending: false }),
      admin
        .from('jobs')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
    ]);

  if (clientsResult.error) return { success: false, error: 'clients_failed' };
  if (membersResult.error) return { success: false, error: 'members_failed' };
  if (projectsResult.error) return { success: false, error: 'projects_failed' };
  if (jobsResult.error) return { success: false, error: 'jobs_failed' };

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
      (member: {
        user_id: string;
        first_name: string | null;
        last_name: string | null;
        role: string;
      }) => ({
        userId: member.user_id,
        firstName: member.first_name ?? '',
        lastName: member.last_name ?? '',
        role: member.role,
      })
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
        client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
        inProgressJobCount: counts.inProgress,
        parkedJobCount: counts.parked,
      };
    }),
    jobs: (jobsResult.data ?? []).map(toJob),
  };
}

async function getProjectClientContext(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  projectId: string
): Promise<
  | { success: true; project: ProjectClientContext }
  | { success: false; error: 'project_not_found' }
> {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, client_id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single();

  if (projectError || !project) {
    return { success: false, error: 'project_not_found' };
  }

  return { success: true, project };
}

// ============================================
// Actions
// ============================================

export async function createJob(
  input: CreateJobInput
): Promise<CreateJobResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    if (!input.title.trim()) {
      return { success: false, error: 'title_required' };
    }

    const jobNumber = input.jobNumber?.trim();
    if (!jobNumber) {
      return { success: false, error: 'job_number_required' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existingNumber } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', orgId)
      .eq('job_number', jobNumber)
      .maybeSingle();

    if (existingNumber) {
      return { success: false, error: 'job_number_taken' };
    }

    let inheritedProjectClientId: string | null | undefined = undefined;
    if (input.projectId) {
      const projectContext = await getProjectClientContext(
        admin,
        orgId,
        input.projectId
      );

      if (!projectContext.success) {
        return { success: false, error: 'project_not_found' };
      }

      inheritedProjectClientId = projectContext.project.client_id;
    }

    if (!input.projectId && input.clientId) {
      const { data: client, error: clientError } = await admin
        .from('clients')
        .select('id')
        .eq('id', input.clientId)
        .eq('organization_id', orgId)
        .single();

      if (clientError || !client) {
        return { success: false, error: 'client_not_found' };
      }
    }

    const { data, error } = await admin
      .from('jobs')
      .insert({
        organization_id: orgId,
        project_id: input.projectId || null,
        client_id:
          inheritedProjectClientId !== undefined
            ? inheritedProjectClientId
            : input.clientId || null,
        job_number: jobNumber,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.plannedDate ? 'nicht_bearbeitet' : 'geparkt',
        priority: input.priority ?? 'mittel',
        planned_date: input.plannedDate || null,
        planned_time: normalizeJobPlannedTime(input.plannedTime),
        estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
        planned_working_minutes: input.plannedWorkingMinutes ?? null,
        location: input.location?.trim() || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating job:', error);
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    if (input.projectId) {
      updateTag(CACHE_TAGS.projects(orgId));
    }

    return { success: true, job: toJob(data) };
  } catch (error) {
    console.error('Unexpected error in createJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateJob(
  jobId: string,
  input: UpdateJobInput
): Promise<UpdateJobResult> {
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
      .select('id, project_id, client_id, status')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'job_not_found' };
    }

    const resultingProjectId =
      input.projectId !== undefined ? input.projectId || null : existing.project_id;
    let inheritedProjectClientId: string | null | undefined = undefined;

    if (resultingProjectId) {
      const projectContext = await getProjectClientContext(
        admin,
        orgId,
        resultingProjectId
      );

      if (!projectContext.success) {
        return { success: false, error: 'project_not_found' };
      }

      inheritedProjectClientId = projectContext.project.client_id;
    }

    if (!resultingProjectId && input.clientId !== undefined && input.clientId) {
      const { data: client, error: clientError } = await admin
        .from('clients')
        .select('id')
        .eq('id', input.clientId)
        .eq('organization_id', orgId)
        .single();

      if (clientError || !client) {
        return { success: false, error: 'client_not_found' };
      }
    }

    if (input.jobNumber !== undefined && input.jobNumber?.trim()) {
      const { data: numberConflict } = await admin
        .from('jobs')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_number', input.jobNumber.trim())
        .neq('id', jobId)
        .maybeSingle();

      if (numberConflict) {
        return { success: false, error: 'job_number_taken' };
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData.title = input.title.trim();
    if (input.description !== undefined)
      updateData.description = input.description?.trim() || null;
    if (input.projectId !== undefined)
      updateData.project_id = input.projectId || null;
    if (resultingProjectId) {
      updateData.client_id = inheritedProjectClientId ?? null;
    } else if (input.clientId !== undefined) {
      updateData.client_id = input.clientId || null;
    }
    if (input.jobNumber !== undefined)
      updateData.job_number = input.jobNumber?.trim() || null;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.plannedDate !== undefined)
      updateData.planned_date = input.plannedDate || null;
    if (input.plannedTime !== undefined)
      updateData.planned_time = normalizeJobPlannedTime(input.plannedTime);
    if (input.estimatedDurationMinutes !== undefined)
      updateData.estimated_duration_minutes =
        input.estimatedDurationMinutes ?? null;
    if (input.plannedWorkingMinutes !== undefined)
      updateData.planned_working_minutes = input.plannedWorkingMinutes ?? null;
    if (input.location !== undefined)
      updateData.location = input.location?.trim() || null;

    if (input.plannedDate !== undefined) {
      if (updateData.planned_date && updateData.planned_date !== null) {
        if (existing.status === 'geparkt') {
          updateData.status = 'nicht_bearbeitet';
        }
      } else {
        // Auto-parking due to date removal preserves all other metadata.
        updateData.status = 'geparkt';
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      console.error('Error updating job:', error);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    revalidatePath('/auftraege', 'layout');

    const projectChanged =
      input.projectId !== undefined &&
      input.projectId !== existing.project_id;
    if (projectChanged || existing.project_id) {
      updateTag(CACHE_TAGS.projects(orgId));
    }

    return { success: true, job: toJob(data) };
  } catch (error) {
    console.error('Unexpected error in updateJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteJob(jobId: string): Promise<DeleteJobResult> {
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

    const { error } = await admin
      .from('jobs')
      .delete()
      .eq('id', jobId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Error deleting job:', error);
      return { success: false, error: 'delete_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    if (existing.project_id) {
      updateTag(CACHE_TAGS.projects(orgId));
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateJobStatus(
  jobId: string,
  newStatus: JobStatus
): Promise<UpdateJobResult> {
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

    const updateData: Record<string, unknown> = { status: newStatus };

    if (newStatus === 'fertig') {
      updateData.actual_completion_date = new Date()
        .toISOString()
        .split('T')[0];
    }

    if (newStatus === 'in_bearbeitung' || newStatus === 'nicht_bearbeitet') {
      updateData.actual_completion_date = null;
    }

    if (newStatus === 'geparkt') {
      updateData.planned_date = null;
      updateData.planned_time = null;
      updateData.actual_completion_date = null;
    }

    const { data, error } = await admin
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      console.error('Error updating job status:', error);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    revalidatePath('/auftraege', 'layout');
    if (existing.project_id) {
      updateTag(CACHE_TAGS.projects(orgId));
    }

    return { success: true, job: toJob(data) };
  } catch (error) {
    console.error('Unexpected error in updateJobStatus:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function assignEmployee(
  jobId: string,
  targetUserId: string
): Promise<AssignEmployeeResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: job, error: jobError } = await admin
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (jobError || !job) {
      return { success: false, error: 'job_not_found' };
    }

    const { data: member, error: memberError } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', targetUserId)
      .eq('organization_id', orgId)
      .single();

    if (memberError || !member) {
      return { success: false, error: 'member_not_found' };
    }

    const { data, error } = await admin
      .from('job_assignments')
      .insert({
        job_id: jobId,
        user_id: targetUserId,
        assigned_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'already_assigned' };
      }
      console.error('Error assigning employee:', error);
      return { success: false, error: 'assign_failed' };
    }

    if (!data) {
      return { success: false, error: 'assign_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    revalidatePath('/auftraege', 'layout');
    revalidatePath('/mitarbeiter', 'layout');

    return { success: true, assignment: toJobAssignment(data) };
  } catch (error) {
    console.error('Unexpected error in assignEmployee:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function unassignEmployee(
  jobId: string,
  targetUserId: string
): Promise<UnassignEmployeeResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: job, error: jobError } = await admin
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (jobError || !job) {
      return { success: false, error: 'job_not_found' };
    }

    const { error } = await admin
      .from('job_assignments')
      .delete()
      .eq('job_id', jobId)
      .eq('user_id', targetUserId);

    if (error) {
      console.error('Error unassigning employee:', error);
      return { success: false, error: 'unassign_failed' };
    }

    updateTag(CACHE_TAGS.jobs(orgId));
    revalidatePath('/auftraege', 'layout');
    revalidatePath('/mitarbeiter', 'layout');

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in unassignEmployee:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getOrgJobs(): Promise<
  { success: true; jobs: Job[] } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    if (isManagerOrAbove) {
      const { data, error } = await admin
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching jobs:', error);
        return { success: false, error: 'fetch_failed' };
      }

      return { success: true, jobs: (data ?? []).map(toJob) };
    }

    const { data: assignments, error: assignError } = await admin
      .from('job_assignments')
      .select('job_id')
      .eq('user_id', userId);

    if (assignError) {
      console.error('Error fetching assignments:', assignError);
      return { success: false, error: 'fetch_failed' };
    }

    const assignedJobIds = (assignments ?? []).map((a) => a.job_id);

    if (assignedJobIds.length === 0) {
      return { success: true, jobs: [] };
    }

    const { data, error } = await admin
      .from('jobs')
      .select('*')
      .eq('organization_id', orgId)
      .in('id', assignedJobIds)
      .order('planned_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching assigned jobs:', error);
      return { success: false, error: 'fetch_failed' };
    }

    return { success: true, jobs: (data ?? []).map(toJob) };
  } catch (error) {
    console.error('Unexpected error in getOrgJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getJobDetails(
  jobId: string
): Promise<
  { success: true; job: JobWithDetails } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: jobData, error: jobError } = await admin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single();

    if (jobError || !jobData) {
      return { success: false, error: 'job_not_found' };
    }

    if (!isManagerOrAbove) {
      const { data: assignment } = await admin
        .from('job_assignments')
        .select('id')
        .eq('job_id', jobId)
        .eq('user_id', userId)
        .single();

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const [assignmentRowsResult, projectResult] = await Promise.all([
      admin.from('job_assignments').select('*').eq('job_id', jobId),
      jobData.project_id
        ? admin
            .from('projects')
            .select('id, name, project_number, client_id')
            .eq('id', jobData.project_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);
    const assignmentRows = assignmentRowsResult.data;

    const assignments: JobAssignmentWithProfile[] = [];
    if (assignmentRows && assignmentRows.length > 0) {
      const userIds = assignmentRows.map((a) => a.user_id);
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', userIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.id, p])
      );

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
    const { data: clientData } = effectiveClientId
      ? await admin.from('clients').select('*').eq('id', effectiveClientId).single()
      : { data: null };

    const client = clientData ? toClient(clientData) : null;
    const project = projectData
      ? {
          id: projectData.id,
          name: projectData.name,
          projectNumber: projectData.project_number,
        }
      : null;

    const job: JobWithDetails = {
      ...toJob({ ...jobData, client_id: effectiveClientId }),
      assignments,
      client,
      project,
    };

    return { success: true, job };
  } catch (error) {
    console.error('Unexpected error in getJobDetails:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getJobByNumber(
  jobNumber: string
): Promise<
  { success: true; job: JobWithDetails } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: jobData, error: jobError } = await admin
      .from('jobs')
      .select('*')
      .eq('organization_id', orgId)
      .eq('job_number', decodeURIComponent(jobNumber))
      .single();

    if (jobError || !jobData) {
      return { success: false, error: 'job_not_found' };
    }

    if (!isManagerOrAbove) {
      const { data: assignment } = await admin
        .from('job_assignments')
        .select('id')
        .eq('job_id', jobData.id)
        .eq('user_id', userId)
        .single();

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const [assignmentRowsResult, projectResult] = await Promise.all([
      admin.from('job_assignments').select('*').eq('job_id', jobData.id),
      jobData.project_id
        ? admin
            .from('projects')
            .select('id, name, project_number, client_id')
            .eq('id', jobData.project_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);
    const assignmentRows = assignmentRowsResult.data;
    const assignments: JobAssignmentWithProfile[] = [];
    if (assignmentRows && assignmentRows.length > 0) {
      const userIds = assignmentRows.map((a) => a.user_id);
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', userIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.id, p])
      );

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
    const { data: clientData } = effectiveClientId
      ? await admin.from('clients').select('*').eq('id', effectiveClientId).single()
      : { data: null };

    const client = clientData ? toClient(clientData) : null;
    const project = projectData
      ? {
          id: projectData.id,
          name: projectData.name,
          projectNumber: projectData.project_number,
        }
      : null;

    const job: JobWithDetails = {
      ...toJob({ ...jobData, client_id: effectiveClientId }),
      assignments,
      client,
      project,
    };

    return { success: true, job };
  } catch (error) {
    console.error('Unexpected error in getJobByNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getNextJobNumber(): Promise<
  { success: true; jobNumber: string } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_job_number', {
      p_org_id: orgId,
    });

    if (error || !data) {
      console.error('Error generating job number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, jobNumber: data as string };
  } catch (error) {
    console.error('Unexpected error in getNextJobNumber:', error);
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
export async function getJobsForClient(
  clientId: string
): Promise<
  ({ success: true } & ClientJobsResult) | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const [directJobsResult, clientProjectsResult] = await Promise.all([
      admin
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId),
    ]);

    if (directJobsResult.error) {
      console.error('Error fetching client jobs:', directJobsResult.error);
      return { success: false, error: 'fetch_failed' };
    }
    if (clientProjectsResult.error) {
      console.error('Error fetching client projects:', clientProjectsResult.error);
      return { success: false, error: 'fetch_failed' };
    }

    const projectRows = clientProjectsResult.data ?? [];
    const projectIds = projectRows.map((p) => p.id);

    let projectChildJobs: typeof directJobsResult.data = [];
    if (projectIds.length > 0) {
      const { data } = await admin
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .in('project_id', projectIds);
      projectChildJobs = data ?? [];
    }

    const jobMap = new Map<string, (typeof directJobsResult.data)[number]>();
    for (const j of directJobsResult.data ?? []) jobMap.set(j.id, j);
    for (const j of projectChildJobs) jobMap.set(j.id, j);

    const jobs = [...jobMap.values()].map(toJob);

    const allProjectIds = [
      ...new Set([
        ...projectIds,
        ...jobs.filter((j) => j.projectId).map((j) => j.projectId!),
      ]),
    ];

    const projects: ProjectWithDetails[] = [];
    if (allProjectIds.length > 0) {
      const knownProjectMap = new Map(projectRows.map((p) => [p.id, p]));

      const missingIds = allProjectIds.filter((id) => !knownProjectMap.has(id));
      if (missingIds.length > 0) {
        const { data: extraRows } = await admin
          .from('projects')
          .select('*')
          .eq('organization_id', orgId)
          .in('id', missingIds);
        for (const r of extraRows ?? []) knownProjectMap.set(r.id, r);
      }

      const { data: allProjectJobs } = await admin
        .from('jobs')
        .select('id, project_id, status')
        .eq('organization_id', orgId)
        .in('project_id', allProjectIds);

      const jobsByProject = new Map<string, { total: number; completed: number; inProgress: number; parked: number }>();
      for (const j of allProjectJobs ?? []) {
        const entry = jobsByProject.get(j.project_id!) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
        entry.total++;
        if (j.status === 'fertig') entry.completed++;
        if (j.status === 'in_bearbeitung') entry.inProgress++;
        if (j.status === 'geparkt') entry.parked++;
        jobsByProject.set(j.project_id!, entry);
      }

      const projClientIds = [
        ...new Set(
          [...knownProjectMap.values()]
            .filter((p) => p.client_id)
            .map((p) => p.client_id!)
        ),
      ];
      const projectClients: Record<string, ReturnType<typeof toClient>> = {};
      if (projClientIds.length > 0) {
        const { data: clientRows } = await admin
          .from('clients')
          .select('*')
          .in('id', projClientIds);
        for (const c of clientRows ?? []) {
          projectClients[c.id] = toClient(c);
        }
      }

      for (const id of allProjectIds) {
        const row = knownProjectMap.get(id);
        if (!row) continue;
        const counts = jobsByProject.get(row.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
        projects.push({
          ...toProject(row),
          client: row.client_id ? (projectClients[row.client_id] ?? null) : null,
          jobCount: counts.total,
          completedJobCount: counts.completed,
          inProgressJobCount: counts.inProgress,
          parkedJobCount: counts.parked,
        });
      }
    }

    const allClientIds = [
      ...new Set(jobs.filter((j) => j.clientId).map((j) => j.clientId!)),
    ];
    const clientMap: Record<string, string> = {};
    if (allClientIds.length > 0) {
      const { data: clientRows } = await admin
        .from('clients')
        .select('id, name')
        .in('id', allClientIds);
      for (const c of clientRows ?? []) {
        clientMap[c.id] = c.name;
      }
    }
    for (const p of projects) {
      if (p.clientId && p.client) {
        clientMap[p.clientId] = p.client.name;
      }
    }

    const allJobIds = jobs.map((j) => j.id);
    const jobAssignmentMap: Record<string, string[]> = {};
    if (allJobIds.length > 0) {
      const { data: allAssignments } = await admin
        .from('job_assignments')
        .select('job_id, user_id')
        .in('job_id', allJobIds);
      for (const a of allAssignments ?? []) {
        if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
        jobAssignmentMap[a.job_id].push(a.user_id);
      }
    }

    return { success: true, jobs, projects, clientMap, jobAssignmentMap };
  } catch (error) {
    console.error('Unexpected error in getJobsForClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
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
export async function getJobsForMember(
  memberId: string
): Promise<
  { success: true } & MemberJobsResult | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: assignments, error: assignError } = await admin
      .from('job_assignments')
      .select('job_id')
      .eq('user_id', memberId);

    if (assignError) {
      console.error('Error fetching member assignments:', assignError);
      return { success: false, error: 'fetch_failed' };
    }

    const assignedJobIds = [...new Set((assignments ?? []).map((a) => a.job_id))];

    if (assignedJobIds.length === 0) {
      return {
        success: true,
        jobs: [],
        projects: [],
        clientMap: {},
        jobAssignmentMap: {},
      };
    }

    const { data: jobRows, error: jobError } = await admin
      .from('jobs')
      .select('*')
      .eq('organization_id', orgId)
      .in('id', assignedJobIds)
      .order('planned_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (jobError) {
      console.error('Error fetching member jobs:', jobError);
      return { success: false, error: 'fetch_failed' };
    }

    const jobs = (jobRows ?? []).map(toJob);

    const projectIds = [...new Set(
      jobs.filter((j) => j.projectId).map((j) => j.projectId!)
    )];

    let projects: ProjectWithDetails[] = [];
    if (projectIds.length > 0) {
      const { data: projectRows } = await admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', projectIds);

      if (projectRows) {
        const { data: allProjectJobs } = await admin
          .from('jobs')
          .select('id, project_id, status')
          .eq('organization_id', orgId)
          .in('project_id', projectIds);

        const jobsByProject = new Map<string, { total: number; completed: number; inProgress: number; parked: number }>();
        for (const j of allProjectJobs ?? []) {
          const entry = jobsByProject.get(j.project_id!) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
          entry.total++;
          if (j.status === 'fertig') entry.completed++;
          if (j.status === 'in_bearbeitung') entry.inProgress++;
          if (j.status === 'geparkt') entry.parked++;
          jobsByProject.set(j.project_id!, entry);
        }

        const clientIds = [...new Set(
          projectRows.filter((p) => p.client_id).map((p) => p.client_id!)
        )];
        const projectClients: Record<string, ReturnType<typeof toClient>> = {};
        if (clientIds.length > 0) {
          const { data: clientRows } = await admin
            .from('clients')
            .select('*')
            .in('id', clientIds);
          if (clientRows) {
            for (const c of clientRows) {
              projectClients[c.id] = toClient(c);
            }
          }
        }

        projects = projectRows.map((row) => {
          const counts = jobsByProject.get(row.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
          return {
            ...toProject(row),
            client: row.client_id ? (projectClients[row.client_id] ?? null) : null,
            jobCount: counts.total,
            completedJobCount: counts.completed,
            inProgressJobCount: counts.inProgress,
            parkedJobCount: counts.parked,
          };
        });
      }
    }

    const allClientIds = [...new Set(
      jobs.filter((j) => j.clientId).map((j) => j.clientId!)
    )];
    const clientMap: Record<string, string> = {};
    if (allClientIds.length > 0) {
      const { data: clientRows } = await admin
        .from('clients')
        .select('id, name')
        .in('id', allClientIds);
      for (const c of clientRows ?? []) {
        clientMap[c.id] = c.name;
      }
    }
    for (const p of projects) {
      if (p.clientId && p.client) {
        clientMap[p.clientId] = p.client.name;
      }
    }

    const { data: allAssignments } = await admin
      .from('job_assignments')
      .select('job_id, user_id')
      .in('job_id', assignedJobIds);

    const jobAssignmentMap: Record<string, string[]> = {};
    for (const a of allAssignments ?? []) {
      if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
      jobAssignmentMap[a.job_id].push(a.user_id);
    }

    return {
      success: true,
      jobs,
      projects,
      clientMap,
      jobAssignmentMap,
    };
  } catch (error) {
    console.error('Unexpected error in getJobsForMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar Integration
// ============================================

/**
 * Fetch jobs for the calendar view. Returns CalendarJob[] with assignment data.
 * Admin/manager see all org jobs; others see only assigned jobs.
 */
export async function getJobsForCalendar(
  from?: string,
  to?: string
): Promise<
  { success: true; jobs: CalendarJob[] } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    let query = admin
      .from('jobs')
      .select('id, title, job_number, status, priority, planned_date, planned_time, estimated_duration_minutes, planned_working_minutes, location, client_id, project_id')
      .eq('organization_id', orgId)
      .neq('status', 'geparkt')
      .not('planned_date', 'is', null);

    if (from) query = query.gte('planned_date', from);
    if (to) query = query.lte('planned_date', to);

    if (!isManagerOrAbove) {
      const { data: assignments } = await admin
        .from('job_assignments')
        .select('job_id')
        .eq('user_id', userId);

      const assignedJobIds = (assignments || []).map((a) => a.job_id);
      if (assignedJobIds.length === 0) {
        return { success: true, jobs: [] };
      }
      query = query.in('id', assignedJobIds);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('Error fetching calendar jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    if (!jobs || jobs.length === 0) {
      return { success: true, jobs: [] };
    }

    const jobIds = jobs.map((j) => j.id);
    const clientIds = jobs.map((j) => j.client_id).filter((id): id is string => id !== null);
    const projectIds = jobs.map((j) => j.project_id).filter((id): id is string => id !== null);

    const [assignmentsResult, clientsResult, projectsResult] = await Promise.all([
      admin.from('job_assignments').select('job_id, user_id').in('job_id', jobIds),
      clientIds.length > 0
        ? admin.from('clients').select('id, name, address').in('id', clientIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; address: string | null }[],
            error: null
          }),
      projectIds.length > 0
        ? admin.from('projects').select('id, name, project_number').in('id', projectIds)
        : Promise.resolve({ data: [] as { id: string; name: string; project_number: string | null }[], error: null }),
    ]);

    const assignmentMap: Record<string, string[]> = {};
    for (const a of assignmentsResult.data || []) {
      if (!assignmentMap[a.job_id]) assignmentMap[a.job_id] = [];
      assignmentMap[a.job_id].push(a.user_id);
    }

    const clientMap: Record<string, { name: string; address: string | null }> = {};
    for (const c of clientsResult.data || []) {
      clientMap[c.id] = {
        name: c.name,
        address: c.address
      };
    }

    const projectMap: Record<string, { name: string; number: string | null }> = {};
    for (const p of projectsResult.data || []) {
      projectMap[p.id] = { name: p.name, number: p.project_number };
    }

    const calendarJobs: CalendarJob[] = jobs.map((j) => ({
      id: j.id,
      jobNumber: j.job_number,
      title: j.title,
      status: j.status as JobStatus,
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
    console.error('Unexpected error in getJobsForCalendar:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Fetch parked jobs — those with status = 'geparkt'.
 * Admin/manager see all org jobs; others see only their assigned jobs.
 */
export async function getParkedJobs(): Promise<
  { success: true; jobs: CalendarJob[] } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    let query = admin
      .from('jobs')
      .select('id, title, job_number, status, priority, planned_date, planned_time, estimated_duration_minutes, planned_working_minutes, location, client_id, project_id, updated_at')
      .eq('organization_id', orgId)
      .eq('status', 'geparkt')
      .order('updated_at', { ascending: true });

    if (!isManagerOrAbove) {
      const { data: assignments } = await admin
        .from('job_assignments')
        .select('job_id')
        .eq('user_id', userId);

      const assignedJobIds = (assignments || []).map((a) => a.job_id);
      if (assignedJobIds.length === 0) {
        return { success: true, jobs: [] };
      }
      query = query.in('id', assignedJobIds);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('Error fetching parked jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    if (!jobs || jobs.length === 0) {
      return { success: true, jobs: [] };
    }

    const jobIds = jobs.map((j) => j.id);
    const clientIds = jobs.map((j) => j.client_id).filter((id): id is string => id !== null);
    const projectIds = jobs.map((j) => j.project_id).filter((id): id is string => id !== null);

    const [assignmentsResult, clientsResult, projectsResult] = await Promise.all([
      admin.from('job_assignments').select('job_id, user_id').in('job_id', jobIds),
      clientIds.length > 0
        ? admin.from('clients').select('id, name, address').in('id', clientIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; address: string | null }[],
            error: null
          }),
      projectIds.length > 0
        ? admin.from('projects').select('id, name, project_number').in('id', projectIds)
        : Promise.resolve({ data: [] as { id: string; name: string; project_number: string | null }[], error: null }),
    ]);

    const assignmentMap: Record<string, string[]> = {};
    for (const a of assignmentsResult.data || []) {
      if (!assignmentMap[a.job_id]) assignmentMap[a.job_id] = [];
      assignmentMap[a.job_id].push(a.user_id);
    }

    const clientMap: Record<string, { name: string; address: string | null }> = {};
    for (const c of clientsResult.data || []) {
      clientMap[c.id] = {
        name: c.name,
        address: c.address
      };
    }

    const projectMap: Record<string, { name: string; number: string | null }> = {};
    for (const p of projectsResult.data || []) {
      projectMap[p.id] = { name: p.name, number: p.project_number };
    }

    const calendarJobs: CalendarJob[] = jobs.map((j) => ({
      id: j.id,
      jobNumber: j.job_number,
      title: j.title,
      status: j.status as JobStatus,
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
    console.error('Unexpected error in getParkedJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
