'use server';

// P1-12 customer commitments: recording and withdrawing an explicitly agreed
// customer window for one planned visit. Recording is a manual office fact —
// nothing here sends, schedules, or implies any message (P1-46 owns delivery).

import { updateTag } from 'next/cache';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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
  rawInput: unknown
): Promise<
  { success: true; commitmentId: string } | { success: false; error: string }
> {
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
    p_window_start_time: parsed.data.windowStartTime ?? undefined,
    p_window_end_time: parsed.data.windowEndTime ?? undefined,
    p_source: parsed.data.source,
    p_contact_id: parsed.data.contactId ?? undefined,
  });
  if (error) {
    console.error('Failed to record customer commitment:', {
      code: error.code ?? 'unknown',
    });
    return {
      success: false,
      error: error.message.includes('commitment_occurrence_not_scheduled')
        ? 'commitment_occurrence_not_scheduled'
        : error.message.includes('commitment_occurrence_not_found')
          ? 'commitment_occurrence_not_found'
          : 'update_failed',
    };
  }
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  return { success: true, commitmentId: data as string };
}

export async function withdrawCustomerCommitment(
  commitmentId: string,
  reason: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!uuidSchema.safeParse(commitmentId).success) {
    return { success: false, error: 'invalid_input' };
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
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
    p_reason: trimmedReason,
  });
  if (error) {
    console.error('Failed to withdraw customer commitment:', {
      code: error.code ?? 'unknown',
    });
    return {
      success: false,
      error: error.message.includes('commitment_not_found')
        ? 'commitment_not_found'
        : 'update_failed',
    };
  }
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  return { success: true };
}
