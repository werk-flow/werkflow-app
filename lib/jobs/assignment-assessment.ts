import 'server-only';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import { loadAssignmentEvaluation } from '@/lib/qualifications/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import type { QualificationWarningResult } from './types';

export type AssignmentContext = {
  admin: AdminClient;
  orgId: string;
  actorId: string;
};

/**
 * The qualification evaluation of a selection, refused with
 * qualification_warning or stale_evaluation unless an approval with a reason
 * matches it.
 */
export async function assessAssignmentSelection(input: {
  context: AssignmentContext;
  jobId?: string | null | undefined;
  selectedUserIds: string[];
  assessedForDate?: string | null | undefined;
  approval?: AssignmentApproval | null | undefined;
  requirementRows?:
    | Array<{
        id: string;
        capability_id: string;
        require_confirmation: boolean;
      }>
    | undefined;
}): Promise<
  { success: true; evaluation: AssignmentEvaluation } | QualificationWarningResult | ActionFailure
> {
  const result = await loadAssignmentEvaluation({
    admin: input.context.admin,
    orgId: input.context.orgId,
    jobId: input.jobId,
    selectedUserIds: input.selectedUserIds,
    assessedForDate: input.assessedForDate,
    requirementRows: input.requirementRows,
  });
  if (!result.success) return result;
  if (!result.evaluation.requiresOverride) return result;
  const approval = input.approval;
  if (!approval) {
    return {
      success: false,
      error: 'qualification_warning',
      evaluation: result.evaluation,
    };
  }
  if (approval.fingerprint !== result.evaluation.fingerprint) {
    return {
      success: false,
      error: 'stale_evaluation',
      evaluation: result.evaluation,
    };
  }
  if (approval.reason.trim().length < 3) {
    return {
      success: false,
      error: 'qualification_warning',
      evaluation: result.evaluation,
    };
  }
  return result;
}

export type AssignmentReplacement = {
  selectedUserIds: string[];
  evaluation: AssignmentEvaluation;
  approval?: AssignmentApproval | null | undefined;
  teamSourceId?: string | null | undefined;
  recordAssessment?: boolean;
};

/** The assignment arguments of replace_job_assignments_with_assessment and of the job write functions that call it. */
export function assignmentReplacementArguments(input: AssignmentReplacement): {
  p_selected_user_ids: string[];
  p_assessed_for_date: string | null;
  p_selected_employee_record_ids: string[];
  p_requirements_snapshot: ReturnType<typeof toJson>;
  p_coverage_snapshot: ReturnType<typeof toJson>;
  p_coverage_fingerprint: string;
  p_override_reason: string | null;
  p_team_source_id: string | null;
  p_record_assessment: boolean;
} {
  return {
    p_selected_user_ids: [...new Set(input.selectedUserIds)].sort(),
    p_assessed_for_date: input.evaluation.assessedForDate,
    p_selected_employee_record_ids: input.evaluation.selectedEmployeeRecordIds,
    p_requirements_snapshot: toJson(input.evaluation.requirementCoverage),
    p_coverage_snapshot: toJson({
      requirements: input.evaluation.requirementCoverage,
      apprentice_warning: input.evaluation.apprenticeWarning,
    }),
    p_coverage_fingerprint: input.evaluation.fingerprint,
    p_override_reason: input.evaluation.requiresOverride ? input.approval?.reason.trim() || null : null,
    p_team_source_id: input.teamSourceId ?? input.approval?.teamSourceId ?? null,
    p_record_assessment:
      input.recordAssessment ??
      (input.evaluation.requirementCoverage.length > 0 ||
        input.evaluation.apprenticeWarning.status !== 'not_configured'),
  };
}

export type ProjectClientContext = {
  id: string;
  client_id: string | null;
  site_id: string | null;
  contact_id: string | null;
};

/** The customer, site and contact a job inherits from its project. */
export async function getProjectClientContext(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ActionResult<{ project: ProjectClientContext }, 'project_not_found'>> {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, client_id, site_id, contact_id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single();

  if (projectError || !project) {
    logReadErrors('getProjectClientContext: read failed', projectError);
    return { success: false, error: 'project_not_found' };
  }

  return { success: true, project };
}
