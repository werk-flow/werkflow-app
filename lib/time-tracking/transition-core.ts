import 'server-only';

import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';

import type { ActionFailure } from '@/lib/action-result';
import { formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { hasActiveSicknessOn } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { hasApprovedFullDayVacationOn } from '@/lib/vacation/server';
import { isPeriodClosedError } from './closed-periods';
import { hashTimeTransitionRequest } from './transition-hash';
import { TIME_TRANSITION_ERROR_CODES } from './types';
import type {
  TimeActivitySelection,
  TimeTransitionAction,
  TimeTransitionError,
  TimeTransitionResult,
} from './types';

// The one write path of a clock transition after the caller is established:
// the Server Action `transitionTimeActivity` (online, from the cookie session)
// and the field sync route (offline-captured, cookie or bearer token) both
// call it. It checks the caller's employee record and absence, then calls the
// versioned database function, which reauthorizes inside its transaction.

/** The caller a transition belongs to, established by the entry point from a verified identity. */
export type TimeTransitionCaller = { userId: string; organizationId: string };

export type TimeTransitionCommand = {
  operationId: string;
  action: TimeTransitionAction;
  expectedSessionId: string | null;
  expectedVersion: number | null;
  selection: TimeActivitySelection | null;
  acknowledgeLong: boolean;
};

/** The device times of a transition captured without signal, as normalized ISO instants. */
export type OfflineCapture = { capturedAt: string; sentAt: string };

/**
 * The database's refusals that only an offline transition names: those of an
 * offline-captured time (migration 20261128090001), and the start gate of a
 * job the office blocked while the phone was offline (an open blocker or start
 * dependency, raised by `transition_work_execution` when a work segment starts
 * the job). An online transition keeps answering `time_transition_failed` for
 * the start gate, so its result is unchanged.
 */
const OFFLINE_REFUSALS = [
  'time_transition_captured_in_future',
  'time_transition_captured_out_of_order',
  'time_transition_correction_required',
  'time_transition_outside_recording_window',
  'work_transition_start_blocked',
] as const;

export type OfflineRefusal = (typeof OFFLINE_REFUSALS)[number];

export type OfflineTransitionResult =
  | Extract<TimeTransitionResult, { success: true }>
  | ActionFailure<TimeTransitionError | OfflineRefusal>;

/** The JSON object `transition_time_activity` returns. */
const transitionPayloadSchema = z.object({
  outcome: z.enum(['active', 'ended', 'no_change', 'recovery_required']),
  sessionId: z.string().nullish(),
  segmentId: z.string().nullish(),
  version: z.number().nullish(),
  recoveryReason: z.string().nullish(),
  replayed: z.boolean().optional(),
  legacyBridged: z.boolean().optional(),
});

function mapTransitionError(
  error: { code?: string; message: string },
  offline: boolean,
): TimeTransitionError | OfflineRefusal {
  if (isPeriodClosedError(error)) return 'period_closed';
  const { message } = error;
  if (offline) {
    const refusal = OFFLINE_REFUSALS.find((code) => message.includes(code));
    if (refusal) return refusal;
  }
  if (message.includes('time_sessions_open_user_unique')) {
    return 'time_transition_working_other_org';
  }
  return (
    TIME_TRANSITION_ERROR_CODES.find(
      (code) => code.startsWith('time_transition_') && message.includes(code),
    ) ?? 'time_transition_failed'
  );
}

/** Whether the operation ledger holds this id already; null when the read failed. */
async function isRecordedOperation(organizationId: string, operationId: string): Promise<boolean | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('time_operations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', operationId)
    .maybeSingle();
  if (error) {
    logError('recordTimeTransition: operation ledger read failed', error);
    return null;
  }
  return data !== null;
}

export async function recordTimeTransition(
  caller: TimeTransitionCaller,
  command: TimeTransitionCommand,
  capture: null,
): Promise<TimeTransitionResult>;
export async function recordTimeTransition(
  caller: TimeTransitionCaller,
  command: TimeTransitionCommand,
  capture: OfflineCapture,
): Promise<OfflineTransitionResult>;
export async function recordTimeTransition(
  caller: TimeTransitionCaller,
  command: TimeTransitionCommand,
  capture: OfflineCapture | null,
): Promise<OfflineTransitionResult> {
  const { userId, organizationId } = caller;
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  // A failed read is never "not a member": it is a failure the caller can repeat.
  if (employeeError) {
    logError('recordTimeTransition: employee record read failed', employeeError);
    return { success: false, error: 'time_transition_failed' };
  }
  if (!employee) return { success: false, error: 'not_a_member' };

  // A resend of a recorded offline operation goes straight to the ledger,
  // which answers its first result: an absence approved since never turns it
  // into a refusal.
  const resent = capture ? await isRecordedOperation(organizationId, command.operationId) : false;
  if (resent === null) return { success: false, error: 'time_transition_failed' };

  let sicknessNotice = false;
  if (!resent && (command.action === 'start' || command.action === 'continue_legacy')) {
    // The business date of the act: today online, the captured day offline.
    const day = capture ? formatBerlinLocalDate(capture.capturedAt) : getBusinessTodayIso();
    if (await hasApprovedFullDayVacationOn(organizationId, userId, day)) {
      return { success: false, error: 'on_approved_vacation' };
    }
    sicknessNotice = await hasActiveSicknessOn(organizationId, userId, day);
  }

  const selection = command.selection;
  const { data, error } = await admin.rpc(
    'transition_time_activity',
    rpcArgs('transition_time_activity', {
      p_organization_id: organizationId,
      p_actor_id: userId,
      p_operation_id: command.operationId,
      p_request_hash: hashTimeTransitionRequest({
        organizationId,
        action: command.action,
        expectedSessionId: command.expectedSessionId,
        expectedVersion: command.expectedVersion,
        selection,
        acknowledgeLong: command.acknowledgeLong,
        ...(capture ? { capturedAt: capture.capturedAt } : {}),
      }),
      p_action: command.action,
      p_expected_session_id: command.expectedSessionId,
      p_expected_version: command.expectedVersion,
      p_segment_kind: selection?.kind ?? null,
      p_allocation_kind: selection?.allocationKind ?? null,
      p_job_id: selection?.jobId ?? null,
      p_internal_type: selection?.internalType ?? null,
      p_travel_route: selection?.travelRoute ?? null,
      p_travel_role: selection?.travelRole ?? null,
      p_standby_context: selection?.standbyContext ?? null,
      p_acknowledge_long: command.acknowledgeLong,
      // An online call omits both, so the database keeps its own clock.
      ...(capture ? { p_captured_at: capture.capturedAt, p_sent_at: capture.sentAt } : {}),
    }),
  );

  if (error) return { success: false, error: mapTransitionError(error, capture !== null) };
  const parsedPayload = transitionPayloadSchema.safeParse(data);
  if (!parsedPayload.success) {
    return { success: false, error: 'time_transition_failed' };
  }
  const payload = parsedPayload.data;
  revalidatePath('/zeiterfassung');
  revalidatePath('/auftraege');

  return {
    success: true,
    outcome: payload.outcome,
    sessionId: payload.sessionId ?? null,
    segmentId: payload.segmentId ?? null,
    version: payload.version ?? null,
    recoveryReason: payload.recoveryReason ?? null,
    replayed: payload.replayed ?? false,
    legacyBridged: payload.legacyBridged ?? false,
    ...(sicknessNotice ? { notice: 'sickness_reported_today' as const } : {}),
  };
}
