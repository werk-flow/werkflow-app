/** The Arbeitsnachweis code a database refusal names, or the generic failure. */
export function mapArtifactError(error: { message?: string } | null): string {
  const known = [
    'work_artifact_not_authorized',
    'work_artifact_stale_version',
    'work_artifact_correction_reason_required',
    'work_artifact_self_approval_not_allowed',
    'work_artifact_not_responsible',
    'work_artifact_review_not_pending',
    'work_artifact_customer_action_requires_customer_visibility',
    'work_artifact_defect_closure_proof_required',
    'work_artifact_is_voided',
    'instruction_evidence_already_fulfilled',
    'instruction_evidence_not_authorized',
  ].find((code) => error?.message?.includes(code));
  return known ?? 'work_artifact_action_failed';
}
