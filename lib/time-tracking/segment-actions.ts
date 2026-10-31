'use server';

import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { timeActivitySelectionSchema as selectionSchema } from './activity-selection-schema';

import { resolveActionContextFor } from '@/lib/org/action-context';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { hasActiveSicknessOn } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { hasApprovedFullDayVacationOn } from '@/lib/vacation/server';
import { isPeriodClosedError } from './closed-periods';
import { hashTimeTransitionRequest } from './transition-hash';
import { TIME_TRANSITION_ERROR_CODES } from './types';
import type { TimeTransitionError, TimeTransitionResult } from './types';

const transitionSchema = z.object({
  organizationId: uuidSchema,
  operationId: uuidSchema,
  action: z.enum([
    'start',
    'switch',
    'end',
    'continue_legacy',
    'end_legacy',
    'recover_continue',
    'recover_end',
  ]),
  expectedSessionId: uuidSchema.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
  selection: selectionSchema.nullable(),
  acknowledgeLong: z.boolean(),
});

export type TimeTransitionInput = z.infer<typeof transitionSchema>;

/** The JSON object `record_time_transition` returns. */
const transitionPayloadSchema = z.object({
  outcome: z.enum(['active', 'ended', 'no_change', 'recovery_required']),
  sessionId: z.string().nullish(),
  segmentId: z.string().nullish(),
  version: z.number().nullish(),
  recoveryReason: z.string().nullish(),
  replayed: z.boolean().optional(),
  legacyBridged: z.boolean().optional(),
});

function mapTransitionError(error: { code?: string; message: string }): TimeTransitionError {
  if (isPeriodClosedError(error)) return 'period_closed';
  const { message } = error;
  if (message.includes('time_sessions_open_user_unique')) {
    return 'time_transition_working_other_org';
  }
  return (
    TIME_TRANSITION_ERROR_CODES.find(
      (code) => code.startsWith('time_transition_') && message.includes(code),
    ) ?? 'time_transition_failed'
  );
}

export async function transitionTimeActivity(rawInput: TimeTransitionInput): Promise<TimeTransitionResult> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const caller = await resolveActionContextFor(input.organizationId);
  if (!caller.success) return caller;
  const userId = caller.context.userId;

  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (employeeError || !employee) return { success: false, error: 'not_a_member' };

  let sicknessNotice = false;
  if (input.action === 'start' || input.action === 'continue_legacy') {
    const today = getBusinessTodayIso();
    if (await hasApprovedFullDayVacationOn(input.organizationId, userId, today)) {
      return { success: false, error: 'on_approved_vacation' };
    }
    sicknessNotice = await hasActiveSicknessOn(input.organizationId, userId, today);
  }

  const selection = input.selection;
  const { data, error } = await admin.rpc(
    'transition_time_activity',
    rpcArgs('transition_time_activity', {
      p_organization_id: input.organizationId,
      p_actor_id: userId,
      p_operation_id: input.operationId,
      p_request_hash: hashTimeTransitionRequest(input),
      p_action: input.action,
      p_expected_session_id: input.expectedSessionId,
      p_expected_version: input.expectedVersion,
      p_segment_kind: selection?.kind ?? null,
      p_allocation_kind: selection?.allocationKind ?? null,
      p_job_id: selection?.jobId ?? null,
      p_internal_type: selection?.internalType ?? null,
      p_travel_route: selection?.travelRoute ?? null,
      p_travel_role: selection?.travelRole ?? null,
      p_standby_context: selection?.standbyContext ?? null,
      p_acknowledge_long: input.acknowledgeLong,
    }),
  );

  if (error) return { success: false, error: mapTransitionError(error) };
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
