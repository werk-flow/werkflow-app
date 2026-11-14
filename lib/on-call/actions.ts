'use server';

import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { resolveActionContextFor, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';

import {
  changeShiftInputSchema,
  endShiftInputSchema,
  handOverInputSchema,
  planShiftInputSchema,
  type ChangeShiftInput,
  type EndShiftInput,
  type HandOverInput,
  type PlanShiftInput,
} from './types';

// The Bereitschaft writes (werk-flow/werkflow-planning#469). Admin and Büro of
// the named organization only. Each write is one database function call that
// checks the role again, locks the shift and writes its history with it. A
// shift books no time: nothing here reaches time tracking.

type ShiftWriteResult = ActionResult<{ shiftId: string; version: number }>;

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;
const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'on_call_shift_exists',
    'on_call_shift_not_found',
    'on_call_shift_changed',
    'on_call_shift_over',
    'on_call_shift_started',
    'on_call_shift_not_running',
    'on_call_shift_invalid_range',
    'on_call_shift_in_past',
    'on_call_shift_overlaps',
    'on_call_member_required',
    'on_call_member_invalid',
  ]),
);
const PLANNING_PATH = '/service/bereitschaft';

async function requirePlanner(
  organizationId: string,
): Promise<
  | { success: true; context: ActionContext }
  | ActionFailure<'not_authenticated' | 'not_a_member' | 'not_authorized'>
> {
  const auth = await resolveActionContextFor(organizationId);
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return auth;
}

/** The written shift's id and version, as every on-call function answers. */
function shiftWritten(data: unknown, logLabel: string): ShiftWriteResult {
  if (isJsonRecord(data) && typeof data.shiftId === 'string' && typeof data.version === 'number') {
    revalidatePath(PLANNING_PATH);
    revalidatePath('/dashboard');
    return { success: true, shiftId: data.shiftId, version: data.version };
  }
  return refusal(null, 'save_failed', logLabel);
}

export async function planOnCallShift(rawInput: PlanShiftInput): Promise<ShiftWriteResult> {
  const parsed = planShiftInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await requirePlanner(input.organizationId);
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'plan_on_call_shift',
    rpcArgs('plan_on_call_shift', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_shift_id: input.shiftId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_label: input.label || null,
      p_handover_note: input.handoverNote,
      p_member_ids: input.memberIds,
      p_confirm_overlap: input.confirmOverlap,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'planOnCallShift: save failed');
  return shiftWritten(data, 'planOnCallShift: unexpected answer');
}

export async function changeOnCallShift(rawInput: ChangeShiftInput): Promise<ShiftWriteResult> {
  const parsed = changeShiftInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await requirePlanner(input.organizationId);
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'change_on_call_shift',
    rpcArgs('change_on_call_shift', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_shift_id: input.shiftId,
      p_expected_version: input.expectedVersion,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_label: input.label || null,
      p_handover_note: input.handoverNote,
      p_member_ids: input.memberIds,
      p_confirm_overlap: input.confirmOverlap,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'changeOnCallShift: save failed');
  return shiftWritten(data, 'changeOnCallShift: unexpected answer');
}

/** Ends a running shift now, or cancels one that has not started. */
export async function endOnCallShift(rawInput: EndShiftInput): Promise<ShiftWriteResult> {
  const parsed = endShiftInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await requirePlanner(input.organizationId);
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'end_on_call_shift',
    rpcArgs('end_on_call_shift', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_shift_id: input.shiftId,
      p_expected_version: input.expectedVersion,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'endOnCallShift: save failed');
  return shiftWritten(data, 'endOnCallShift: unexpected answer');
}

/** Ends the running shift now and starts the next with the note; answers the next shift. */
export async function handOverOnCallShift(rawInput: HandOverInput): Promise<ShiftWriteResult> {
  const parsed = handOverInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await requirePlanner(input.organizationId);
  if (!auth.success) return auth;
  const { data, error } = await createSupabaseAdminClient().rpc(
    'hand_over_on_call_shift',
    rpcArgs('hand_over_on_call_shift', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_shift_id: input.shiftId,
      p_expected_version: input.expectedVersion,
      p_next_shift_id: input.nextShiftId,
      p_next_ends_at: input.nextEndsAt,
      p_next_label: input.nextLabel || null,
      p_handover_note: input.handoverNote,
      p_member_ids: input.memberIds,
      p_confirm_overlap: input.confirmOverlap,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'handOverOnCallShift: save failed');
  return shiftWritten(data, 'handOverOnCallShift: unexpected answer');
}
