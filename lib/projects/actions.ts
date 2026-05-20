'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import {
  type Project,
  type ProjectStatus,
  type ProjectWithDetails,
  type DerivedProjectStatus,
  type CreateProjectResult,
  type UpdateProjectResult,
  type DeleteProjectResult,
  toProject,
  toClient,
  toJob,
  calculateProjectProgress,
  calculateTrafficLight,
  getEffectiveProjectStatus,
} from '@/lib/jobs/types';

// ============================================
// Input Types
// ============================================

export type CreateProjectInput = {
  name: string;
  description?: string;
  clientId?: string;
  projectNumber?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
};

export type UpdateProjectInput = Partial<CreateProjectInput> & {
  statusOverride?: ProjectStatus | null;
};

// ============================================
// Result Types
// ============================================

export type ProjectDetailsResult = {
  project: Project;
  client: ReturnType<typeof toClient> | null;
  jobs: ReturnType<typeof toJob>[];
  derivedStatus: DerivedProjectStatus;
};

// ============================================
// Actions
// ============================================

export async function createProject(
  input: CreateProjectInput
): Promise<CreateProjectResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const name = input.name.trim();
    const description = input.description?.trim() ?? '';
    if (!name && !description) {
      return { success: false, error: 'name_or_description_required' };
    }

    const projectNumber = input.projectNumber?.trim();
    if (!projectNumber) {
      return { success: false, error: 'project_number_required' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existingNumber } = await admin
      .from('projects')
      .select('id')
      .eq('organization_id', orgId)
      .eq('project_number', projectNumber)
      .maybeSingle();

    if (existingNumber) {
      return { success: false, error: 'project_number_taken' };
    }

    if (input.clientId) {
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
      .from('projects')
      .insert({
        organization_id: orgId,
        client_id: input.clientId || null,
        name,
        description: description || null,
        project_number: input.projectNumber?.trim() || null,
        planned_start_date: input.plannedStartDate || null,
        planned_end_date: input.plannedEndDate || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating project:', error);
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.projects(orgId));

    return { success: true, project: toProject(data) };
  } catch (error) {
    console.error('Unexpected error in createProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput
): Promise<UpdateProjectResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('projects')
      .select('id, client_id, name, description')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'project_not_found' };
    }

    const resultingName =
      input.name !== undefined ? input.name.trim() : existing.name.trim();
    const resultingDescription =
      input.description !== undefined
        ? input.description?.trim() ?? ''
        : existing.description?.trim() ?? '';

    if (!resultingName && !resultingDescription) {
      return { success: false, error: 'name_or_description_required' };
    }

    if (input.clientId !== undefined && input.clientId) {
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

    if (input.projectNumber !== undefined && input.projectNumber?.trim()) {
      const { data: numberConflict } = await admin
        .from('projects')
        .select('id')
        .eq('organization_id', orgId)
        .eq('project_number', input.projectNumber.trim())
        .neq('id', projectId)
        .maybeSingle();

      if (numberConflict) {
        return { success: false, error: 'project_number_taken' };
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.description !== undefined)
      updateData.description = input.description?.trim() || null;
    if (input.clientId !== undefined)
      updateData.client_id = input.clientId || null;
    if (input.projectNumber !== undefined)
      updateData.project_number = input.projectNumber?.trim() || null;
    if (input.plannedStartDate !== undefined)
      updateData.planned_start_date = input.plannedStartDate || null;
    if (input.plannedEndDate !== undefined)
      updateData.planned_end_date = input.plannedEndDate || null;
    if (input.statusOverride !== undefined)
      updateData.status_override = input.statusOverride;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      console.error('Error updating project:', error);
      return { success: false, error: 'update_failed' };
    }

    if (
      input.clientId !== undefined &&
      input.clientId !== existing.client_id
    ) {
      const { error: syncJobsError } = await admin
        .from('jobs')
        .update({ client_id: data.client_id })
        .eq('organization_id', orgId)
        .eq('project_id', projectId);

      if (syncJobsError) {
        console.error('Error syncing project job clients:', syncJobsError);

        await admin
          .from('projects')
          .update({ client_id: existing.client_id })
          .eq('id', projectId)
          .eq('organization_id', orgId);

        return { success: false, error: 'update_failed' };
      }
    }

    updateTag(CACHE_TAGS.projects(orgId));
    updateTag(CACHE_TAGS.jobs(orgId));

    return { success: true, project: toProject(data) };
  } catch (error) {
    console.error('Unexpected error in updateProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteProject(
  projectId: string
): Promise<DeleteProjectResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'project_not_found' };
    }

    const { error } = await admin
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Error deleting project:', error);
      return { success: false, error: 'delete_failed' };
    }

    updateTag(CACHE_TAGS.projects(orgId));
    updateTag(CACHE_TAGS.jobs(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getOrgProjects(): Promise<
  | { success: true; projects: ProjectWithDetails[] }
  | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    let projectRows;

    if (isManagerOrAbove) {
      const { data, error } = await admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching projects:', error);
        return { success: false, error: 'fetch_failed' };
      }

      projectRows = data ?? [];
    } else {
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
        return { success: true, projects: [] };
      }

      const { data: jobs, error: jobError } = await admin
        .from('jobs')
        .select('project_id')
        .eq('organization_id', orgId)
        .in('id', assignedJobIds)
        .not('project_id', 'is', null);

      if (jobError) {
        console.error('Error fetching job project IDs:', jobError);
        return { success: false, error: 'fetch_failed' };
      }

      const projectIds = [
        ...new Set(
          (jobs ?? [])
            .map((j) => j.project_id)
            .filter((id): id is string => id !== null)
        ),
      ];

      if (projectIds.length === 0) {
        return { success: true, projects: [] };
      }

      const { data, error } = await admin
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching assigned projects:', error);
        return { success: false, error: 'fetch_failed' };
      }

      projectRows = data ?? [];
    }

    if (projectRows.length === 0) {
      return { success: true, projects: [] };
    }

    const projectIds = projectRows.map((p) => p.id);
    const { data: allJobs } = await admin
      .from('jobs')
      .select('project_id, status')
      .in('project_id', projectIds);

    const jobCountMap = new Map<
      string,
      { total: number; completed: number; inProgress: number; parked: number }
    >();
    for (const job of allJobs ?? []) {
      if (!job.project_id) continue;
      const current = jobCountMap.get(job.project_id) ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
        parked: 0,
      };
      current.total++;
      if (job.status === 'fertig') current.completed++;
      if (job.status === 'in_bearbeitung') current.inProgress++;
      if (job.status === 'geparkt') current.parked++;
      jobCountMap.set(job.project_id, current);
    }

    const clientIds = [
      ...new Set(
        projectRows
          .map((p) => p.client_id)
          .filter((id): id is string => id !== null)
      ),
    ];

    let clientMap = new Map<string, ReturnType<typeof toClient>>();
    if (clientIds.length > 0) {
      const { data: clients } = await admin
        .from('clients')
        .select('*')
        .in('id', clientIds);

      clientMap = new Map(
        (clients ?? []).map((c) => [c.id, toClient(c)])
      );
    }

    const projects: ProjectWithDetails[] = projectRows.map((row) => {
      const counts = jobCountMap.get(row.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
      return {
        ...toProject(row),
        client: row.client_id ? clientMap.get(row.client_id) ?? null : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
        inProgressJobCount: counts.inProgress,
        parkedJobCount: counts.parked,
      };
    });

    return { success: true, projects };
  } catch (error) {
    console.error('Unexpected error in getOrgProjects:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getProjectDetails(
  projectId: string
): Promise<
  | { success: true; details: ProjectDetailsResult }
  | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: projectData, error: projectError } = await admin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (projectError || !projectData) {
      return { success: false, error: 'project_not_found' };
    }

    if (!isManagerOrAbove) {
      const { data: assignments } = await admin
        .from('job_assignments')
        .select('job_id, jobs!inner(project_id)')
        .eq('user_id', userId);

      const hasAccess = (assignments ?? []).some((a) => {
        const job = a.jobs as unknown as { project_id: string | null };
        return job?.project_id === projectId;
      });

      if (!hasAccess) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const [jobsResult, clientResult] = await Promise.all([
      admin
        .from('jobs')
        .select('*')
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      projectData.client_id
        ? admin
            .from('clients')
            .select('*')
            .eq('id', projectData.client_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const jobs = (jobsResult.data ?? []).map(toJob);

    let client = null;
    if (clientResult.data) {
      client = toClient(clientResult.data);
    }

    const project = toProject(projectData);
    const progress = calculateProjectProgress(jobs);
    const trafficLight = calculateTrafficLight(project, jobs);
    const status = getEffectiveProjectStatus(project, jobs);

    const derivedStatus: DerivedProjectStatus = {
      status,
      progress,
      trafficLight,
    };

    return {
      success: true,
      details: { project, client, jobs, derivedStatus },
    };
  } catch (error) {
    console.error('Unexpected error in getProjectDetails:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getProjectByNumber(
  projectNumber: string
): Promise<
  | { success: true; details: ProjectDetailsResult }
  | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: projectData, error: projectError } = await admin
      .from('projects')
      .select('*')
      .eq('organization_id', orgId)
      .eq('project_number', decodeURIComponent(projectNumber))
      .single();

    if (projectError || !projectData) {
      return { success: false, error: 'project_not_found' };
    }

    if (!isManagerOrAbove) {
      const { data: assignments } = await admin
        .from('job_assignments')
        .select('job_id, jobs!inner(project_id)')
        .eq('user_id', userId);

      const hasAccess = (assignments ?? []).some((a) => {
        const job = a.jobs as unknown as { project_id: string | null };
        return job?.project_id === projectData.id;
      });

      if (!hasAccess) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const [jobsResult, clientResult] = await Promise.all([
      admin
        .from('jobs')
        .select('*')
        .eq('project_id', projectData.id)
        .eq('organization_id', orgId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      projectData.client_id
        ? admin
            .from('clients')
            .select('*')
            .eq('id', projectData.client_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const jobs = (jobsResult.data ?? []).map(toJob);

    let client = null;
    if (clientResult.data) {
      client = toClient(clientResult.data);
    }

    const project = toProject(projectData);
    const progress = calculateProjectProgress(jobs);
    const trafficLight = calculateTrafficLight(project, jobs);
    const status = getEffectiveProjectStatus(project, jobs);

    const derivedStatus: DerivedProjectStatus = {
      status,
      progress,
      trafficLight,
    };

    return {
      success: true,
      details: { project, client, jobs, derivedStatus },
    };
  } catch (error) {
    console.error('Unexpected error in getProjectByNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getNextProjectNumber(): Promise<
  { success: true; projectNumber: string } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_project_number', {
      p_org_id: orgId,
    });

    if (error || !data) {
      console.error('Error generating project number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, projectNumber: data as string };
  } catch (error) {
    console.error('Unexpected error in getNextProjectNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Park an entire project: sets statusOverride to 'geparkt' and
 * bulk-updates all child jobs to status='geparkt' with cleared dates.
 */
export async function parkProject(
  projectId: string
): Promise<UpdateProjectResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: project, error: fetchError } = await admin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !project) {
      return { success: false, error: 'project_not_found' };
    }

    const { error: updateError } = await admin
      .from('projects')
      .update({ status_override: 'geparkt' })
      .eq('id', projectId)
      .eq('organization_id', orgId);

    if (updateError) {
      console.error('Error parking project:', updateError);
      return { success: false, error: 'update_failed' };
    }

    const { error: jobsError } = await admin
      .from('jobs')
      .update({
        status: 'geparkt',
        planned_date: null,
        planned_time: null,
        actual_completion_date: null,
      })
      .eq('project_id', projectId)
      .eq('organization_id', orgId)
      .neq('status', 'fertig');

    if (jobsError) {
      console.error('Error parking project jobs:', jobsError);
    }

    updateTag(CACHE_TAGS.projects(orgId));
    updateTag(CACHE_TAGS.jobs(orgId));

    return { success: true, project: toProject({ ...project, status_override: 'geparkt' }) };
  } catch (error) {
    console.error('Unexpected error in parkProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
