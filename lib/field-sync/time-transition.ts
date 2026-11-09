import 'server-only';

import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import {
  recordTimeTransition,
  type OfflineCapture,
  type OfflineRefusal,
  type OfflineTransitionResult,
} from '@/lib/time-tracking/transition-core';
import type { TimeTransitionError } from '@/lib/time-tracking/types';
import { FORBIDDEN, INVALID, UNAVAILABLE, type FieldSyncVerdict } from './outcomes';

// The `time.transition` operation of field sync v1: a clock start, switch or
// end captured on the phone, recorded at its captured time through the same
// transition core as an online clock call. The database function owns the
// offline window, the order rule and the closed periods; this module maps its
// answer to an outcome class.

export const TIME_TRANSITION_KIND = 'time.transition';

const payloadSchema = z.strictObject({
  action: z.enum(['start', 'switch', 'end']),
  expectedSessionId: uuidSchema.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
  selection: timeActivitySelectionSchema.nullable(),
  acknowledgeLong: z.boolean(),
});

/** The clock state after an accepted, replayed or recovery-bound transition. */
type TimeTransitionState = {
  sessionId: string | null;
  segmentId: string | null;
  version: number | null;
};

export type TimeTransitionVerdict = FieldSyncVerdict & { state?: TimeTransitionState };

const STATE_MOVED: FieldSyncVerdict = { outcome: 'conflict', code: 'version_conflict' };
const OFFICE_CHANGED: FieldSyncVerdict = { outcome: 'conflict', code: 'office_changed' };

/** Every refusal the transition core can answer, with its outcome. TypeScript fails on an unmapped code. */
const REFUSAL_VERDICTS: Record<TimeTransitionError | OfflineRefusal, FieldSyncVerdict> = {
  invalid_input: INVALID,
  time_transition_invalid_input: INVALID,
  time_transition_action_invalid: INVALID,
  time_transition_segment_required: INVALID,
  time_transition_allocation_invalid: INVALID,
  time_transition_travel_invalid: INVALID,
  time_transition_standby_invalid: INVALID,
  time_transition_break_mode_automatic: INVALID,
  time_transition_captured_in_future: INVALID,
  not_authenticated: FORBIDDEN,
  no_active_org: FORBIDDEN,
  not_a_member: FORBIDDEN,
  time_transition_not_authorized: FORBIDDEN,
  time_transition_employee_missing: FORBIDDEN,
  time_transition_job_not_assigned: FORBIDDEN,
  time_transition_job_unavailable: FORBIDDEN,
  period_closed: { outcome: 'rejected', code: 'closed_period' },
  time_transition_outside_recording_window: { outcome: 'rejected', code: 'outside_recording_window' },
  time_transition_idempotency_conflict: { outcome: 'rejected', code: 'idempotency_conflict' },
  time_transition_correction_required: { outcome: 'conflict', code: 'correction_required' },
  time_transition_recovery_ack_required: { outcome: 'conflict', code: 'recovery_required' },
  time_transition_stale_version: STATE_MOVED,
  time_transition_captured_out_of_order: STATE_MOVED,
  time_transition_already_open: STATE_MOVED,
  time_transition_not_open: STATE_MOVED,
  time_transition_legacy_open: STATE_MOVED,
  time_transition_legacy_state_changed: STATE_MOVED,
  time_transition_recovery_state_changed: STATE_MOVED,
  time_transition_working_other_org: STATE_MOVED,
  time_transition_job_terminal: OFFICE_CHANGED,
  work_transition_start_blocked: OFFICE_CHANGED,
  on_approved_vacation: OFFICE_CHANGED,
  time_transition_failed: UNAVAILABLE,
};

/** The outcome of a transition result. A stored `recovery_required` answer stays a conflict on every resend. */
function transitionVerdict(result: OfflineTransitionResult): TimeTransitionVerdict {
  if (!result.success) return REFUSAL_VERDICTS[result.error];
  const state = { sessionId: result.sessionId, segmentId: result.segmentId, version: result.version };
  if (result.outcome === 'recovery_required')
    return { outcome: 'conflict', code: 'recovery_required', state };
  return result.replayed
    ? { outcome: 'replayed', code: 'replayed', state }
    : { outcome: 'accepted', code: 'accepted', state };
}

/**
 * Records one `time.transition` operation for a caller whose membership in
 * the operation's organization is established. A session the operation
 * expects must exist in that organization and be the caller's own.
 */
export async function replayTimeTransition(
  caller: { userId: string; organizationId: string },
  operation: { operationId: string; payload: unknown; capture: OfflineCapture },
): Promise<TimeTransitionVerdict> {
  const parsed = payloadSchema.safeParse(operation.payload);
  if (!parsed.success) return INVALID;
  const payload = parsed.data;
  if (payload.expectedSessionId !== null) {
    const { data: session, error } = await createSupabaseAdminClient()
      .from('time_sessions')
      .select('user_id')
      .eq('organization_id', caller.organizationId)
      .eq('id', payload.expectedSessionId)
      .maybeSingle();
    if (error) return UNAVAILABLE;
    // A session of another person, of another organization or of none is no session to act on.
    if (session?.user_id !== caller.userId) return FORBIDDEN;
  }
  const result = await recordTimeTransition(
    caller,
    { operationId: operation.operationId, ...payload },
    operation.capture,
  );
  return transitionVerdict(result);
}
