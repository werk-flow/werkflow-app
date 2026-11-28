'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { convertOfferSchema, type ConvertOfferInput } from './types';

// „In Arbeit übernehmen“: an accepted offer becomes work once
// (supabase/migrations/20270701160000_convert_an_accepted_offer_into_work_once.sql).
// The action resolves the caller's organization and manager role on the
// server and passes only those; the one database function call checks the
// actor again, refuses every id outside the organization, creates or binds
// the work, writes the order baseline, the billing parties, the planned
// material and the offer's history.

type ConversionResult = ActionResult<{
  offerId: string;
  version: number;
  kind: 'job' | 'project';
  workId: string;
  /** The article lines planned as no material, by printed number. */
  unplannedPositions: string[];
}>;

const convertedSchema = z.object({
  version: z.number().int().positive(),
  kind: z.enum(['job', 'project']),
  workId: uuidSchema,
  unplannedPositions: z.array(z.string()),
});

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'offer_not_found',
    'offer_not_accepted',
    'offer_changed',
    'offer_converted',
    'work_not_found',
    'client_required',
    'client_not_found',
    'client_archived',
    'recipient_not_found',
    'site_not_found',
    'contact_not_found',
  ]),
);

/** Creates the work of an accepted offer, or binds the job or project it was written for. */
export async function convertOfferToWork(rawInput: ConvertOfferInput): Promise<ConversionResult> {
  const parsed = convertOfferSchema.safeParse(rawInput);
  // A new job or project needs its title; the offer's own work keeps its own.
  if (!parsed.success || (parsed.data.target !== 'offer_work' && parsed.data.title === '')) {
    return { success: false, error: 'invalid_input' };
  }
  const input = parsed.data;
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { data, error } = await createSupabaseAdminClient().rpc('convert_offer_to_work', {
      p_actor_id: caller.context.userId,
      p_organization_id: caller.context.orgId,
      p_offer_id: input.offerId,
      p_expected_version: input.expectedVersion,
      p_attempt_key: input.attemptKey,
      p_target: input.target,
      p_title: input.title,
    });
    const answer = convertedSchema.safeParse(data);
    if (error || !answer.success) return refusal(error, 'save_failed', 'convertOfferToWork: convert_offer_to_work failed');
    // The offer's page renders the link to the work into this answer; the work's pages hear it through Realtime.
    revalidatePath(`/angebote/${input.offerId}`);
    revalidatePath('/auftraege', 'layout');
    return { success: true, offerId: input.offerId, ...answer.data };
  } catch (error) {
    logError('convertOfferToWork: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
