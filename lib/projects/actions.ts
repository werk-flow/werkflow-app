'use server';

import type { ActionResult } from '@/lib/action-result';
import { revalidatePath, updateTag } from 'next/cache';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import {
  type Project,
  type ProjectRow,
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
import { validateSiteAndContactForClient } from '@/lib/clients/site-contact-validation';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { createProjectInputSchema, updateProjectArgumentsSchema } from './action-schemas';
import { PROJECT_CREATION_REFUSALS, projectCreationColumns } from './creation';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { toJson } from '@/lib/supabase/json';
import { CUSTOMER_REFERENCE_REFUSALS, workWriteFailure } from '@/lib/jobs/write-refusals';

const PROJECT_UPDATE_REFUSALS = [
  'project_not_found',
  'name_or_description_required',
  'project_number_taken',
  ...CUSTOMER_REFERENCE_REFUSALS,
];

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
  // Default site/contact for the project's jobs; each job may override.
  siteId?: string;
  contactId?: string;
  templateVersionId?: string;
};

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'templateVersionId'>>;

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

export async function createProject(rawInput: CreateProjectInput): Promise<CreateProjectResult> {
  const parsedInput = createProjectInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { userId, orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    // One transaction: the project and its work template, or nothing.
    const { data, error } = await createSupabaseAdminClient().rpc(
      'create_project_with_template',
      rpcArgs('create_project_with_template', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_project: projectCreationColumns(input),
        p_template_version_id: input.templateVersionId || null,
      }),
    );
    if (error) {
      return workWriteFailure('Error creating project:', error, PROJECT_CREATION_REFUSALS, 'create_failed');
    }

    updateTag(CACHE_TAGS.workTemplates(orgId));

    return { success: true, project: toProject(data) };
  } catch (error) {
    logError('Unexpected error in createProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
export async function updateProject(
  rawProjectId: string,
  rawInput: UpdateProjectInput,
): Promise<UpdateProjectResult> {
  const parsedArguments = updateProjectArgumentsSchema.safeParse({
    projectId: rawProjectId,
    input: rawInput,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { projectId, input } = parsedArguments.data;
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
      .select('id, client_id, site_id, contact_id, name, description')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'project_not_found' };
    }

    const resultingName = input.name !== undefined ? input.name.trim() : existing.name.trim();
    const resultingDescription =
      input.description !== undefined
        ? (input.description?.trim() ?? '')
        : (existing.description?.trim() ?? '');

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
      const { data: numberConflict, error: numberConflictError } = await loggedRead(
        'updateProject: projects read failed',
        admin
          .from('projects')
          .select('id')
          .eq('organization_id', orgId)
          .eq('project_number', input.projectNumber.trim())
          .neq('id', projectId)
          .maybeSingle(),
      );
      if (numberConflictError) return { success: false, error: 'load_failed' };

      if (numberConflict) {
        return { success: false, error: 'project_number_taken' };
      }
    }

    const resultingClientId = input.clientId !== undefined ? input.clientId || null : existing.client_id;
    const clientChanged = resultingClientId !== existing.client_id;

    // A customer change invalidates the previous customer's site/contact.
    const resultingSiteId =
      input.siteId !== undefined ? input.siteId || null : clientChanged ? null : existing.site_id;
    const resultingContactId =
      input.contactId !== undefined ? input.contactId || null : clientChanged ? null : existing.contact_id;

    if (input.siteId !== undefined || input.contactId !== undefined || clientChanged) {
      const siteContactCheck = await validateSiteAndContactForClient(
        admin,
        orgId,
        resultingClientId,
        resultingSiteId,
        resultingContactId,
      );
      if (!siteContactCheck.success) {
        return siteContactCheck;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.description !== undefined) updateData.description = input.description?.trim() || null;
    if (input.clientId !== undefined) updateData.client_id = input.clientId || null;
    if (input.siteId !== undefined || clientChanged) updateData.site_id = resultingSiteId;
    if (input.contactId !== undefined || clientChanged) updateData.contact_id = resultingContactId;
    if (input.projectNumber !== undefined) updateData.project_number = input.projectNumber?.trim() || null;
    if (input.plannedStartDate !== undefined) updateData.planned_start_date = input.plannedStartDate || null;
    if (input.plannedEndDate !== undefined) updateData.planned_end_date = input.plannedEndDate || null;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    // One transaction: the project and, on a customer change, its jobs, which
    // lose the previous customer's site and contact.
    const { data, error } = await admin.rpc(
      'update_project_with_jobs',
      rpcArgs('update_project_with_jobs', {
        p_organization_id: orgId,
        p_project_id: projectId,
        p_changes: toJson(updateData),
      }),
    );

    if (error) {
      return workWriteFailure('Error updating project:', error, PROJECT_UPDATE_REFUSALS, 'update_failed');
    }

    // Like updateJob: the response renders the acting page, so no client refresh follows a save.
    revalidatePath('/auftraege', 'layout');

    return { success: true, project: toProject(data) };
  } catch (error) {
    logError('Unexpected error in updateProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
export async function deleteProject(rawProjectId: string): Promise<DeleteProjectResult> {
  const parsedProjectId = uuidSchema.safeParse(rawProjectId);
  if (!parsedProjectId.success) return { success: false, error: 'project_not_found' };
  const projectId = parsedProjectId.data;
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

    const { error } = await admin.from('projects').delete().eq('id', projectId).eq('organization_id', orgId);

    if (error) {
      logError('Error deleting project:', error);
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
/**
 * The shared tail of the project detail readers: an employee reads only a
 * project with one of their assigned jobs; the project comes back with its
 * customer, its jobs and the derived status.
 */
async function readProjectDetails(input: {
  admin: AdminClient;
  context: { userId: string; orgId: string; isManagerOrAbove: boolean };
  projectData: ProjectRow;
  operation: string;
}): Promise<ActionResult<{ details: ProjectDetailsResult }>> {
  const { admin, projectData } = input;
  const { userId, orgId, isManagerOrAbove } = input.context;

  if (!isManagerOrAbove) {
    // One matching assignment proves access; reading every assignment of the
    // user would truncate at the PostgREST row cap.
    // tenant-scope: child-of-verified-parent — the inner join keeps only jobs of the project read above with this organization's filter.
    const { data: assignments, error: accessError } = await admin
      .from('job_assignments')
      .select('job_id, jobs!inner(project_id)')
      .eq('user_id', userId)
      .eq('jobs.project_id', projectData.id)
      .limit(1);
    if (accessError) {
      logReadFailure(`${input.operation}: project access check failed`, accessError);
      return { success: false, error: 'fetch_failed' };
    }
    if (assignments.length === 0) {
      return { success: false, error: 'not_authorized' };
    }
  }

  const [jobsResult, clientResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('*')
          .eq('project_id', projectData.id)
          .eq('organization_id', orgId)
          .order('planned_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    projectData.client_id
      ? admin
          .from('clients')
          .select('*')
          .eq('organization_id', orgId)
          .eq('id', projectData.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (jobsResult.error || clientResult.error) {
    logError('Error fetching project jobs or customer:', jobsResult.error ?? clientResult.error);
    return { success: false, error: 'fetch_failed' };
  }
  const jobs = jobsResult.data.map(toJob);

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
}

export async function getProjectDetails(
  rawProjectId: string,
): Promise<ActionResult<{ details: ProjectDetailsResult }>> {
  const parsedProjectId = uuidSchema.safeParse(rawProjectId);
  if (!parsedProjectId.success) return { success: false, error: 'project_not_found' };
  const projectId = parsedProjectId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: projectData, error: projectError } = await admin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (projectError || !projectData) {
      logReadErrors('getProjectDetails: read failed', projectError);
      return { success: false, error: 'project_not_found' };
    }

    return await readProjectDetails({
      admin,
      context: auth.context,
      projectData,
      operation: 'getProjectDetails',
    });
  } catch (error) {
    logError('Unexpected error in getProjectDetails:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getProjectByNumber(
  rawProjectNumber: string,
): Promise<ActionResult<{ details: ProjectDetailsResult }>> {
  const parsedProjectNumber = z.string().max(300).safeParse(rawProjectNumber);
  if (!parsedProjectNumber.success) return { success: false, error: 'project_not_found' };
  const projectNumber = parsedProjectNumber.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    const { data: projectData, error: projectError } = await admin
      .from('projects')
      .select('*')
      .eq('organization_id', orgId)
      .eq('project_number', decodeURIComponent(projectNumber))
      .single();

    // `.single()` reports a missing row as PGRST116; any other error is a failed read, not a missing project.
    if (projectError && projectError.code !== 'PGRST116') {
      logReadErrors('getProjectByNumber: read failed', projectError);
      return { success: false, error: 'load_failed' };
    }
    if (!projectData) return { success: false, error: 'project_not_found' };

    return await readProjectDetails({
      admin,
      context: auth.context,
      projectData,
      operation: 'getProjectByNumber',
    });
  } catch (error) {
    logError('Unexpected error in getProjectByNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getNextProjectNumber(): Promise<ActionResult<{ projectNumber: string }>> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_project_number', {
      p_org_id: orgId,
    });

    if (error || !data) {
      logError('Error generating project number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, projectNumber: data as string };
  } catch (error) {
    logError('Unexpected error in getNextProjectNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
