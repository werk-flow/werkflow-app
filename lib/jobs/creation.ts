import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import type { Database } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { loadWorkTemplateRequirementRows } from '@/lib/work-templates/server';
import type { z } from '@/lib/zod';
import type { createJobInputSchema } from './action-schemas';
import {
  assessAssignmentSelection,
  assignmentReplacementArguments,
  type AssignmentContext,
} from './assignment-assessment';
import { normalizeJobPlannedTime, type QualificationWarningResult } from './types';

type JobCreationInput = z.infer<typeof createJobInputSchema>;

type JobCreationFunctionArguments = Database['public']['Functions']['create_job_with_assignments']['Args'];

/** The arguments every job creation function shares, without the organization and the actor. */
export type JobCreationArguments = {
  [Key in Exclude<keyof JobCreationFunctionArguments, 'p_organization_id' | 'p_actor_id'>]:
    | JobCreationFunctionArguments[Key]
    | null;
};

/** The refusals of app_private.create_job_record, each an action failure code. */
export const JOB_CREATION_REFUSALS = [
  'invalid_input',
  'title_or_description_required',
  'job_number_required',
  'job_number_taken',
  'project_not_found',
  'client_not_found',
  'site_requires_client',
  'site_not_found',
  'site_client_mismatch',
  'contact_requires_client',
  'contact_not_found',
  'contact_client_mismatch',
  'assign_failed',
  'work_template_version_unavailable',
  'work_template_reference_unavailable',
  'work_template_qualification_assessment_required',
  'template_apply_failed',
] as const;

/**
 * Assesses the selected people against the template's requirements and builds
 * the job columns, the assignment and the template arguments of a job
 * creation function. The function checks the job and its references under
 * lock. An undefined site or contact inherits the project's; an empty one
 * clears it. A null job number leaves the number to the function.
 */
export async function prepareJobCreation(
  context: AssignmentContext,
  input: JobCreationInput,
  jobNumber: string | null,
): Promise<{ success: true; arguments: JobCreationArguments } | QualificationWarningResult | ActionFailure> {
  const templateVersionId = input.templateVersionId || null;
  const templateRequirements = templateVersionId
    ? await loadWorkTemplateRequirementRows({
        admin: context.admin,
        organizationId: context.orgId,
        versionId: templateVersionId,
      })
    : { success: true as const, rows: [], templateRequirementCount: 0 };
  if (!templateRequirements.success) return templateRequirements;

  const selectedUserIds = input.selectedUserIds ?? [];
  const assessment = await assessAssignmentSelection({
    context,
    selectedUserIds,
    assessedForDate: input.plannedDate,
    approval: input.assignmentApproval,
    requirementRows: templateVersionId ? templateRequirements.rows : undefined,
  });
  if (!assessment.success) return assessment;

  const job = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    project_id: input.projectId || null,
    client_id: input.clientId || null,
    ...(input.siteId !== undefined ? { site_id: input.siteId || null } : {}),
    ...(input.contactId !== undefined ? { contact_id: input.contactId || null } : {}),
    priority: input.priority ?? 'mittel',
    planned_date: input.plannedDate || null,
    planned_time: normalizeJobPlannedTime(input.plannedTime),
    estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
    planned_working_minutes: input.plannedWorkingMinutes ?? null,
    location: input.location?.trim() || null,
    ...(jobNumber !== null ? { job_number: jobNumber.trim() } : {}),
  };
  return {
    success: true,
    arguments: {
      p_job: toJson(job),
      ...assignmentReplacementArguments({
        selectedUserIds,
        evaluation: assessment.evaluation,
        approval: input.assignmentApproval,
        teamSourceId: input.assignmentTeamSourceId,
        // A template with requirements records the assessment itself.
        recordAssessment: templateRequirements.templateRequirementCount === 0,
      }),
      p_template_version_id: templateVersionId,
      p_template_assessment: templateRequirements.templateRequirementCount > 0,
    },
  };
}
