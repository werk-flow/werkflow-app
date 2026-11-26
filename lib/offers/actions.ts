'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import {
  createOfferSchema,
  updateOfferSchema,
  type CreateOfferInput,
  type UpdateOfferInput,
} from './action-schemas';

// Admin and Büro keep the offers. Every action resolves the caller's
// organization and manager role on the server and passes only those; the
// database function checks the actor again, refuses every id outside the
// organization and writes the history in the same call
// (supabase/migrations/20261210130000_keep_offers_for_the_right_customer_and_recipient.sql,
// 20261230110000_change_the_header_of_a_draft_offer.sql).

const createRefusal = writeRefusalFor(
  new Set(['not_authorized', 'client_not_found', 'client_archived', 'site_not_found', 'contact_not_found']),
);

const updateRefusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'offer_not_found',
    'offer_not_editable',
    'offer_changed',
    'site_not_found',
    'contact_not_found',
    'recipient_not_found',
    'recipient_archived',
    'owner_not_found',
  ]),
);

/** Creates an offer in „Entwurf“ with the default recipient, validity and texts. */
export async function createOffer(rawInput: CreateOfferInput): Promise<ActionResult<{ offerId: string }>> {
  const parsed = createOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId, userId } = caller.context;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      'create_offer',
      rpcArgs('create_offer', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_attempt_key: input.attemptKey,
        p_title: input.title,
        p_client_id: input.clientId,
        p_site_id: input.siteId,
        p_contact_id: input.contactId,
        // A request becomes an offer through its own conversion; the dialog names no work.
        p_work_kind: null,
        p_work_id: null,
      }),
    );
    if (error || !data) return createRefusal(error, 'save_failed', 'createOffer: create_offer failed');
    return { success: true, offerId: data };
  } catch (error) {
    logError('createOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

const savedHeaderSchema = z.object({ version: z.number().int().positive(), updatedAt: z.string() });

/**
 * Saves the header of an offer in „Entwurf“ that is still at the version the
 * form was filled from. The answer names the offer, its version and its
 * transaction stamp, so the saving tab knows the Realtime echo of this save.
 */
export async function updateOffer(
  rawInput: UpdateOfferInput,
): Promise<ActionResult<{ offerId: string; version: number; updatedAt: string }>> {
  const parsed = updateOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId, userId } = caller.context;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      'update_offer',
      rpcArgs('update_offer', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_offer_id: input.offerId,
        p_expected_version: input.expectedVersion,
        p_attempt_key: input.attemptKey,
        p_title: input.title,
        p_site_id: input.siteId,
        p_contact_id: input.contactId,
        p_recipient_client_id: input.recipientClientId,
        p_valid_until: input.validUntil,
        p_opening_text: input.openingText,
        p_closing_text: input.closingText,
        p_owner_user_id: input.ownerUserId,
      }),
    );
    const saved = savedHeaderSchema.safeParse(data);
    if (error || !saved.success) {
      return updateRefusal(error, 'save_failed', 'updateOffer: update_offer failed');
    }
    // The page renders the saved header into this answer; another session hears it through Realtime.
    revalidatePath(`/angebote/${input.offerId}`);
    return { success: true, offerId: input.offerId, ...saved.data };
  } catch (error) {
    logError('updateOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
