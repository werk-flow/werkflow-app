'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import { acceptedScopeTotals } from './accepted-scope';
import {
  acceptOfferSchema,
  offerDecisionReasonSchema,
  type AcceptOfferInput,
  type OfferDecisionReasonInput,
} from './action-schemas';
import { readRevisionContent } from './decision-reads';

// The customer's decision on a sent offer, as the office records it
// (supabase/migrations/20270701120000_record_an_offer_acceptance_and_freeze_its_scope.sql).
// Each action resolves the caller's organization and manager role on the
// server and passes only those; the one database function call checks the
// actor again, refuses every id outside the organization and writes the
// history. An answer names the offer's version and transaction stamp, so the
// recording tab knows the Realtime echo of its own write.

type DecisionResult = ActionResult<{ offerId: string; version: number; updatedAt: string }>;

const decidedSchema = z.object({ version: z.number().int().positive(), updatedAt: z.string() });

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'offer_not_found',
    'offer_not_sent',
    'offer_decided',
    'offer_changed',
    'offer_not_accepted',
    'offer_converted',
    'revision_superseded',
    'scope_mismatch',
  ]),
);

async function officeCaller() {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  return caller;
}

/**
 * „Annahme erfassen“: the newest sent revision is accepted by the person the
 * office names, on a day, through a channel, with the chosen options. The
 * server computes the Auftragsumfang's totals from the frozen revision; the
 * database builds and freezes its lines. An open draft of the next revision
 * closes in the same call.
 */
export async function acceptOffer(rawInput: AcceptOfferInput): Promise<DecisionResult> {
  const parsed = acceptOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const content = await readRevisionContent(orgId, input.offerId, input.revision);
    // No such revision of this organization: the call refuses with the reason, before any total counts.
    const totals = content
      ? acceptedScopeTotals(content, input.chosenOptions)
      : { netCents: 0, taxCents: 0, grossCents: 0 };
    if (!totals) return { success: false, error: 'invalid_input' };
    const { data, error } = await createSupabaseAdminClient().rpc('accept_offer', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_offer_id: input.offerId,
      p_expected_version: input.expectedVersion,
      p_attempt_key: input.attemptKey,
      p_revision: input.revision,
      p_accepted_by_name: input.acceptedByName,
      p_accepted_on: input.acceptedOn,
      p_channel: input.channel,
      p_note: input.note,
      p_chosen_options: input.chosenOptions,
      p_totals: toJson(totals),
    });
    return decided(input.offerId, data, error, 'acceptOffer: accept_offer failed');
  } catch (error) {
    logError('acceptOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** „Annahme zurücknehmen“: the standing Annahme stays, marked withdrawn with the reason; the offer is sent again. */
export async function withdrawOfferAcceptance(rawInput: OfferDecisionReasonInput): Promise<DecisionResult> {
  const parsed = offerDecisionReasonSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { data, error } = await createSupabaseAdminClient().rpc('withdraw_offer_acceptance', {
      p_actor_id: caller.context.userId,
      p_organization_id: caller.context.orgId,
      p_offer_id: input.offerId,
      p_expected_version: input.expectedVersion,
      p_attempt_key: input.attemptKey,
      p_reason: input.reason,
    });
    return decided(input.offerId, data, error, 'withdrawOfferAcceptance: withdraw_offer_acceptance failed');
  } catch (error) {
    logError('withdrawOfferAcceptance: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** „Ablehnung erfassen“ or „Zurückziehen“ of a sent offer, with the reason. */
export async function closeOffer(
  rawInput: OfferDecisionReasonInput & { outcome: 'abgelehnt' | 'zurueckgezogen' },
): Promise<DecisionResult> {
  const parsed = offerDecisionReasonSchema
    .extend({ outcome: z.enum(['abgelehnt', 'zurueckgezogen']) })
    .safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { data, error } = await createSupabaseAdminClient().rpc('close_offer', {
      p_actor_id: caller.context.userId,
      p_organization_id: caller.context.orgId,
      p_offer_id: input.offerId,
      p_expected_version: input.expectedVersion,
      p_attempt_key: input.attemptKey,
      p_outcome: input.outcome,
      p_reason: input.reason,
    });
    return decided(input.offerId, data, error, 'closeOffer: close_offer failed');
  } catch (error) {
    logError('closeOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

function decided(
  offerId: string,
  data: unknown,
  error: { message: string } | null,
  label: string,
): DecisionResult {
  const answer = decidedSchema.safeParse(data);
  if (error || !answer.success) return refusal(error, 'save_failed', label);
  // The page renders the decision into this answer; another session hears it through Realtime.
  revalidatePath(`/angebote/${offerId}`);
  return { success: true, offerId, ...answer.data };
}
