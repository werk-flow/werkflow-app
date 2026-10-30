import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { loadAssignmentEvaluation } from '@/lib/qualifications/server';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import type { AdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';

import { loadWorkTemplateRequirementRows } from './server';
import type { ApplyWorkTemplateInput } from './types';

// The qualification check before a template applies to a job. applyWorkTemplate
// in actions.ts authorizes the manager before it runs.

type QualificationAssessment = ApplyWorkTemplateInput['qualificationAssessment'];

/**
 * The job team's coverage of the merged template and job requirements. A
 * warning without a matching approval refuses with the evaluation; the
 * assessment is recorded only when the template brings requirements.
 */
export async function assessWorkTemplateQualifications(input: {
  admin: AdminClient;
  organizationId: string;
  jobId: string;
  templateVersionId: string;
  assignmentApproval: AssignmentApproval | null | undefined;
}): Promise<
  | { success: true; qualificationAssessment: QualificationAssessment }
  | ActionFailure
  | (ActionFailure & { evaluation: AssignmentEvaluation })
> {
  const { admin, organizationId, jobId, assignmentApproval } = input;
  const [assignmentsResult, requirements] = await Promise.all([
    admin
      .from('job_assignments')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('job_id', jobId)
      .limit(201),
    loadWorkTemplateRequirementRows({
      admin,
      organizationId,
      versionId: input.templateVersionId,
      jobId,
    }),
  ]);
  if (assignmentsResult.error || (assignmentsResult.data?.length ?? 0) > 200) {
    logReadFailure('applyWorkTemplate: assignment read failed or exceeded 200 rows', {
      code: assignmentsResult.error?.code ?? 'assignment_overflow',
    });
    return { success: false, error: 'load_failed' };
  }
  if (!requirements.success) return { success: false, error: 'load_failed' };
  const evaluationResult = await loadAssignmentEvaluation({
    admin,
    orgId: organizationId,
    jobId,
    selectedUserIds: (assignmentsResult.data ?? []).map((row) => row.user_id),
    requirementRows: requirements.rows,
  });
  if (!evaluationResult.success) return evaluationResult;
  const evaluation = evaluationResult.evaluation;
  if (evaluation.requiresOverride) {
    if (!assignmentApproval) return { success: false, error: 'qualification_warning', evaluation };
    if (assignmentApproval.fingerprint !== evaluation.fingerprint)
      return { success: false, error: 'stale_evaluation', evaluation };
    if (assignmentApproval.reason.trim().length < 3)
      return { success: false, error: 'qualification_warning', evaluation };
  }
  if (requirements.templateRequirementCount === 0) {
    return { success: true, qualificationAssessment: undefined };
  }
  return {
    success: true,
    qualificationAssessment: {
      assessedForDate: evaluation.assessedForDate,
      selectedUserIds: evaluation.selectedUserIds,
      selectedEmployeeRecordIds: evaluation.selectedEmployeeRecordIds,
      requirementsSnapshot: toJson(evaluation.requirementCoverage),
      coverageSnapshot: toJson({
        requirements: evaluation.requirementCoverage,
        apprentice_warning: evaluation.apprenticeWarning,
      }),
      coverageFingerprint: evaluation.fingerprint,
      overrideReason: evaluation.requiresOverride ? assignmentApproval?.reason.trim() || null : null,
      teamSourceId: assignmentApproval?.teamSourceId ?? null,
    },
  };
}
