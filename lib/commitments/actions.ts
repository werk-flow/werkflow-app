'use server';

// Customer commitments: recording and withdrawing an explicitly agreed
// customer window for one planned visit. Recording is a manual office fact —
// nothing here sends, schedules, or implies any message (P1-46 owns delivery).

import type { ActionResult } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';

const recordCommitmentSchema = z
  .object({
    occurrenceId: uuidSchema,
    committedDate: z.string().date(),
    windowStartTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    windowEndTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    source: z.enum(['telefonisch', 'vor_ort', 'schriftlich_manuell', 'sonstige']),
    contactId: uuidSchema.nullable(),
  })
  .superRefine((value, context) => {
    if ((value.windowStartTime === null) !== (value.windowEndTime === null)) {
      context.addIssue({
        code: 'custom',
        path: ['windowEndTime'],
        message: 'Bitte Beginn und Ende des Zeitfensters angeben.',
      });
    }
    if (
      value.windowStartTime !== null &&
      value.windowEndTime !== null &&
      value.windowEndTime <= value.windowStartTime
    ) {
      context.addIssue({
        code: 'custom',
        path: ['windowEndTime'],
        message: 'Das Zeitfenster muss nach dem Beginn enden.',
      });
    }
  });

export async function recordCustomerCommitment(
  rawInput: unknown,
): Promise<ActionResult<{ commitmentId: string }>> {
  const parsed = recordCommitmentSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('record_customer_commitment', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_occurrence_id: parsed.data.occurrenceId,
    p_committed_date: parsed.data.committedDate,
    ...(parsed.data.windowStartTime ? { p_window_start_time: parsed.data.windowStartTime } : {}),
    ...(parsed.data.windowEndTime ? { p_window_end_time: parsed.data.windowEndTime } : {}),
    p_source: parsed.data.source,
    ...(parsed.data.contactId ? { p_contact_id: parsed.data.contactId } : {}),
  });
  if (error) {
    logError('Failed to record customer commitment:', error);
    return {
      success: false,
      error: error.message.includes('commitment_occurrence_not_scheduled')
        ? 'commitment_occurrence_not_scheduled'
        : error.message.includes('commitment_occurrence_not_found')
          ? 'commitment_occurrence_not_found'
          : 'update_failed',
    };
  }
  return { success: true, commitmentId: data as string };
}

export async function withdrawCustomerCommitment(
  commitmentId: string,
  reason: string,
): Promise<ActionResult> {
  if (!uuidSchema.safeParse(commitmentId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const parsedReason = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsedReason.success) {
    return { success: false, error: 'withdrawal_reason_invalid' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('withdraw_customer_commitment', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_commitment_id: commitmentId,
    p_reason: parsedReason.data,
  });
  if (error) {
    logError('Failed to withdraw customer commitment:', error);
    return {
      success: false,
      error: error.message.includes('commitment_not_found') ? 'commitment_not_found' : 'update_failed',
    };
  }
  return { success: true };
}
