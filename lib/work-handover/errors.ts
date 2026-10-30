/** The handover code a database refusal names, or the generic failure. */
export function mapHandoverError(error: { message?: string } | null): string {
  const codes = [
    'work_handover_not_authorized',
    'work_handover_stale_version',
    'work_handover_execution_state_invalid',
    'work_handover_source_stale',
    'work_handover_package_empty',
    'work_handover_gate_stale',
    'work_handover_gate_snapshot_invalid',
    'work_handover_active_clock',
    'work_handover_review_blocked',
    'work_handover_override_reason_required',
    'work_handover_override_not_needed',
    'work_handover_release_state_invalid',
    'work_handover_release_required',
    'work_transition_stale_version',
    'work_transition_not_allowed',
    'work_handover_idempotency_conflict',
  ];
  return codes.find((code) => error?.message?.includes(code)) ?? 'work_handover_action_failed';
}
