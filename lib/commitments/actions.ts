'use server';

// P1-12 customer commitments: recording and withdrawing an explicitly agreed
// customer window for one planned visit. Recording is a manual office fact —
// nothing here sends, schedules, or implies any message (P1-46 owns delivery).

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { formatProfileName } from '@/lib/members/profile-name';
import type { CustomerCommitment } from './types';

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

export type RecordCommitmentInput = z.infer<typeof recordCommitmentSchema>;

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
  revalidatePath('/kalender');
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
  revalidatePath('/kalender');
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  return { success: true };
}

export async function getActiveCommitmentsForOccurrences(
  occurrenceIds: string[]
): Promise<
  | { success: true; commitments: CustomerCommitment[] }
  | { success: false; error: string }
> {
  // Malformed ids reject the whole call rather than being silently dropped.
  if (
    occurrenceIds.some((id) => !uuidSchema.safeParse(id).success)
  ) {
    return { success: false, error: 'invalid_input' };
  }
  const uniqueIds = [...new Set(occurrenceIds)];
  if (uniqueIds.length === 0) return { success: true, commitments: [] };
  if (uniqueIds.length > 500) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from('planning_customer_commitments')
    .select(
      'id, occurrence_id, committed_date, window_start_time, window_end_time, source, contact_id, status, withdrawal_reason, recorded_by, recorded_at'
    )
    .eq('organization_id', auth.context.orgId)
    .eq('status', 'active')
    .in('occurrence_id', uniqueIds);
  if (error) {
    console.error('Failed to load customer commitments:', { code: error.code ?? 'unknown' });
    return { success: false, error: 'load_failed' };
  }

  const contactIds = [
    ...new Set(
      (rows ?? []).flatMap((row) => (row.contact_id ? [row.contact_id] : []))
    ),
  ];
  const recorderIds = [
    ...new Set(
      (rows ?? []).flatMap((row) => (row.recorded_by ? [row.recorded_by] : []))
    ),
  ];
  const [contactsResult, profilesResult] = await Promise.all([
    contactIds.length
      ? admin
          .from('client_contacts')
          .select('id, name')
          .eq('organization_id', auth.context.orgId)
          .in('id', contactIds)
      : { data: [], error: null },
    recorderIds.length
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', recorderIds)
      : { data: [], error: null },
  ]);
  if (contactsResult.error || profilesResult.error) {
    console.error('Failed to resolve commitment references:', {
      code: (contactsResult.error ?? profilesResult.error)?.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  const contactNames = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact.name])
  );
  const recorderNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      formatProfileName(profile),
    ])
  );

  return {
    success: true,
    commitments: (rows ?? []).map((row) => ({
      id: row.id,
      occurrenceId: row.occurrence_id,
      committedDate: row.committed_date,
      windowStartTime: row.window_start_time,
      windowEndTime: row.window_end_time,
      source: row.source,
      contactId: row.contact_id,
      contactName: row.contact_id
        ? (contactNames.get(row.contact_id) ?? null)
        : null,
      status: row.status,
      withdrawalReason: row.withdrawal_reason,
      recordedAt: row.recorded_at,
      recordedByName: row.recorded_by
        ? (recorderNames.get(row.recorded_by) ?? null)
        : null,
    })),
  };
}
