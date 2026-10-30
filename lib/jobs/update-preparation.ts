import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { validateSiteAndContactForClient } from '@/lib/clients/site-contact-validation';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AssignmentEvaluation } from '@/lib/qualifications/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { z } from '@/lib/zod';
import type { updateJobArgumentsSchema } from './action-schemas';
import {
  assessAssignmentSelection,
  assignmentReplacementArguments,
  getProjectClientContext,
} from './assignment-assessment';
import { normalizeJobPlannedTime, type JobRow, type QualificationWarningResult } from './types';

/** A job edit after the boundary parse. */
type JobUpdateChanges = z.output<typeof updateJobArgumentsSchema>['input'];

type JobUpdateArguments = Database['public']['Functions']['update_job_with_assignments']['Args'];

type StoredJob = Pick<
  JobRow,
  | 'id'
  | 'project_id'
  | 'client_id'
  | 'site_id'
  | 'contact_id'
  | 'status'
  | 'execution_state'
  | 'title'
  | 'description'
  | 'planned_date'
>;

/** The stored job the edit is checked against; null when it is missing or the read failed. */
async function readStoredJob(admin: AdminClient, orgId: string, jobId: string): Promise<StoredJob | null> {
  const { data: existing, error: fetchError } = await admin
    .from('jobs')
    .select(
      'id, project_id, client_id, site_id, contact_id, status, execution_state, title, description, planned_date',
    )
    .eq('id', jobId)
    .eq('organization_id', orgId)
    .single();
  return fetchError || !existing ? null : existing;
}

/**
 * Checks the edit's title, project, customer and job number against the
 * stored job, and returns the resulting project with the customer it passes
 * on to its jobs.
 */
async function checkJobReferences(
  admin: AdminClient,
  orgId: string,
  { jobId, input, existing }: { jobId: string; input: JobUpdateChanges; existing: StoredJob },
): Promise<
  | { success: true; resultingProjectId: string | null; inheritedProjectClientId: string | null | undefined }
  | ActionFailure
> {
  const resultingTitle = input.title !== undefined ? input.title.trim() : existing.title.trim();
  const resultingDescription =
    input.description !== undefined
      ? (input.description?.trim() ?? '')
      : (existing.description?.trim() ?? '');

  if (!resultingTitle && !resultingDescription) {
    return { success: false, error: 'title_or_description_required' };
  }

  const resultingProjectId = input.projectId !== undefined ? input.projectId || null : existing.project_id;
  let inheritedProjectClientId: string | null | undefined = undefined;

  if (resultingProjectId) {
    const projectContext = await getProjectClientContext(admin, orgId, resultingProjectId);

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
    const { data: numberConflict, error: numberConflictError } = await loggedRead(
      'updateJob: jobs read failed',
      admin
        .from('jobs')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_number', input.jobNumber.trim())
        .neq('id', jobId)
        .maybeSingle(),
    );
    if (numberConflictError) return { success: false, error: 'load_failed' };

    if (numberConflict) {
      return { success: false, error: 'job_number_taken' };
    }
  }
  return { success: true, resultingProjectId, inheritedProjectClientId };
}

/** The customer, site and contact the edit leaves on the job, checked to belong together. */
async function resolveJobCustomer(
  admin: AdminClient,
  orgId: string,
  {
    input,
    existing,
    resultingProjectId,
    inheritedProjectClientId,
  }: {
    input: JobUpdateChanges;
    existing: StoredJob;
    resultingProjectId: string | null;
    inheritedProjectClientId: string | null | undefined;
  },
): Promise<
  | {
      success: true;
      clientChanged: boolean;
      resultingSiteId: string | null;
      resultingContactId: string | null;
    }
  | ActionFailure
> {
  const resultingClientId = resultingProjectId
    ? (inheritedProjectClientId ?? null)
    : input.clientId !== undefined
      ? input.clientId || null
      : existing.client_id;
  const clientChanged = resultingClientId !== existing.client_id;

  // A customer change invalidates the previous customer's site/contact;
  // they are cleared unless the caller provides new valid ones.
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
  return { success: true, clientChanged, resultingSiteId, resultingContactId };
}

/** The job columns the edit changes, as `update_job_with_assignments` takes them. */
function jobChangeColumns({
  input,
  existing,
  resultingProjectId,
  inheritedProjectClientId,
  clientChanged,
  resultingSiteId,
  resultingContactId,
}: {
  input: JobUpdateChanges;
  existing: StoredJob;
  resultingProjectId: string | null;
  inheritedProjectClientId: string | null | undefined;
  clientChanged: boolean;
  resultingSiteId: string | null;
  resultingContactId: string | null;
}): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (input.title !== undefined) updateData.title = input.title.trim();
  if (input.description !== undefined) updateData.description = input.description?.trim() || null;
  if (input.projectId !== undefined) updateData.project_id = input.projectId || null;
  if (resultingProjectId) {
    updateData.client_id = inheritedProjectClientId ?? null;
  } else if (input.clientId !== undefined) {
    updateData.client_id = input.clientId || null;
  }
  if (input.siteId !== undefined || clientChanged) updateData.site_id = resultingSiteId;
  if (input.contactId !== undefined || clientChanged) updateData.contact_id = resultingContactId;
  if (input.jobNumber !== undefined) updateData.job_number = input.jobNumber?.trim() || null;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.plannedDate !== undefined) updateData.planned_date = input.plannedDate || null;
  if (input.plannedTime !== undefined) updateData.planned_time = normalizeJobPlannedTime(input.plannedTime);
  if (input.estimatedDurationMinutes !== undefined)
    updateData.estimated_duration_minutes = input.estimatedDurationMinutes ?? null;
  if (input.plannedWorkingMinutes !== undefined)
    updateData.planned_working_minutes = input.plannedWorkingMinutes ?? null;
  if (input.location !== undefined) updateData.location = input.location?.trim() || null;

  if (
    input.plannedDate !== undefined &&
    updateData.planned_date &&
    existing.status === 'geparkt' &&
    existing.execution_state === null
  ) {
    // Parked rows without an execution state stay usable. New parking
    // is resolved explicitly before planning and never follows the date.
    updateData.status = 'nicht_bearbeitet';
  }
  return updateData;
}

/** The arguments of `update_job_with_assignments`: the job row and, when assessed, its assignments. */
function jobUpdateArguments({
  orgId,
  jobId,
  actorId,
  input,
  updateData,
  assignmentAssessment,
  finalSelectedUserIds,
}: {
  orgId: string;
  jobId: string;
  actorId: string;
  input: JobUpdateChanges;
  updateData: Record<string, unknown>;
  assignmentAssessment: AssignmentEvaluation | null;
  finalSelectedUserIds: string[] | null;
}): JobUpdateArguments {
  // One transaction: the job row and, when assessed, its assignments with the assessment.
  const assignmentArguments =
    assignmentAssessment && finalSelectedUserIds
      ? assignmentReplacementArguments({
          selectedUserIds: finalSelectedUserIds,
          evaluation: assignmentAssessment,
          approval: input.assignmentApproval,
          teamSourceId: input.assignmentTeamSourceId,
        })
      : null;
  return rpcArgs('update_job_with_assignments', {
    p_organization_id: orgId,
    p_job_id: jobId,
    p_actor_id: actorId,
    p_changes: toJson(updateData),
    p_replace_assignments: assignmentArguments !== null,
    p_selected_user_ids: assignmentArguments?.p_selected_user_ids ?? null,
    p_assessed_for_date: assignmentArguments?.p_assessed_for_date ?? null,
    p_selected_employee_record_ids: assignmentArguments?.p_selected_employee_record_ids ?? null,
    p_requirements_snapshot: assignmentArguments?.p_requirements_snapshot ?? null,
    p_coverage_snapshot: assignmentArguments?.p_coverage_snapshot ?? null,
    p_coverage_fingerprint: assignmentArguments?.p_coverage_fingerprint ?? null,
    p_override_reason: assignmentArguments?.p_override_reason ?? null,
    p_team_source_id: assignmentArguments?.p_team_source_id ?? null,
    p_record_assessment: assignmentArguments?.p_record_assessment ?? null,
  });
}

/**
 * Checks a job edit against the stored job and assesses its assignments, and
 * returns the arguments of `update_job_with_assignments`. It writes nothing:
 * a refusal or a qualification warning leaves the job as it was. The caller
 * has established the actor's right to edit jobs of the organization.
 */
export async function prepareJobUpdate({
  admin,
  orgId,
  actorId,
  jobId,
  input,
}: {
  admin: AdminClient;
  orgId: string;
  actorId: string;
  jobId: string;
  input: JobUpdateChanges;
}): Promise<{ success: true; arguments: JobUpdateArguments } | QualificationWarningResult | ActionFailure> {
  const existing = await readStoredJob(admin, orgId, jobId);
  if (!existing) {
    return { success: false, error: 'job_not_found' };
  }

  const references = await checkJobReferences(admin, orgId, { jobId, input, existing });
  if (!references.success) return references;
  const { resultingProjectId, inheritedProjectClientId } = references;

  const customer = await resolveJobCustomer(admin, orgId, {
    input,
    existing,
    resultingProjectId,
    inheritedProjectClientId,
  });
  if (!customer.success) return customer;
  const { clientChanged, resultingSiteId, resultingContactId } = customer;

  const updateData = jobChangeColumns({
    input,
    existing,
    resultingProjectId,
    inheritedProjectClientId,
    clientChanged,
    resultingSiteId,
    resultingContactId,
  });

  const shouldAssessAssignments = input.selectedUserIds !== undefined || input.plannedDate !== undefined;
  let assignmentAssessment: AssignmentEvaluation | null = null;
  let finalSelectedUserIds: string[] | null = null;
  if (shouldAssessAssignments) {
    if (input.selectedUserIds !== undefined) {
      finalSelectedUserIds = input.selectedUserIds;
    } else {
      const { data: currentAssignments, error: assignmentLoadError } = await admin
        .from('job_assignments')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('job_id', jobId);
      if (assignmentLoadError) {
        return { success: false, error: 'load_failed' };
      }
      finalSelectedUserIds = (currentAssignments ?? []).map((row) => row.user_id);
    }
    const assessmentResult = await assessAssignmentSelection({
      context: { admin, orgId, actorId },
      jobId,
      selectedUserIds: finalSelectedUserIds,
      assessedForDate: input.plannedDate !== undefined ? input.plannedDate || null : existing.planned_date,
      approval: input.assignmentApproval,
    });
    if (!assessmentResult.success) return assessmentResult;
    assignmentAssessment = assessmentResult.evaluation;
  }

  if (Object.keys(updateData).length === 0 && input.selectedUserIds === undefined) {
    return { success: false, error: 'no_changes' };
  }

  return {
    success: true,
    arguments: jobUpdateArguments({
      orgId,
      jobId,
      actorId,
      input,
      updateData,
      assignmentAssessment,
      finalSelectedUserIds,
    }),
  };
}
