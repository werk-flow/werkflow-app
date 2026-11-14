'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
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
// (supabase/migrations/20261204100000_keep_offers_for_the_right_customer_and_recipient.sql).

const REFERENCE_REFUSALS = [
  'client_not_found',
  'client_archived',
  'site_not_found',
  'contact_not_found',
  'recipient_not_found',
  'work_not_found',
] as const;
const createRefusal = writeRefusalFor(new Set(['not_authorized', ...REFERENCE_REFUSALS]));
const updateRefusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'offer_not_found',
    'offer_not_editable',
    'offer_changed',
    'owner_not_found',
    ...REFERENCE_REFUSALS,
  ]),
);

/** The caller in the active organization, refused unless Admin or Büro. */
async function resolveManager() {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' as const };
  return caller;
}

/** Creates an offer in „Entwurf“ with the default recipient, validity and texts. */
export async function createOffer(rawInput: CreateOfferInput): Promise<ActionResult<{ offerId: string }>> {
  const parsed = createOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
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

/** Saves the header of an offer in „Entwurf“ that is still at the version the form saw. */
export async function updateOffer(rawInput: UpdateOfferInput): Promise<ActionResult<{ version: number }>> {
  const parsed = updateOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
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
        p_client_id: input.clientId,
        p_site_id: input.siteId,
        p_contact_id: input.contactId,
        p_recipient_client_id: input.recipientClientId,
        p_valid_until: input.validUntil,
        p_opening_text: input.openingText,
        p_closing_text: input.closingText,
        p_owner_user_id: input.ownerUserId,
        p_work_kind: input.work?.kind ?? null,
        p_work_id: input.work?.id ?? null,
      }),
    );
    if (error || typeof data !== 'number')
      return updateRefusal(error, 'save_failed', 'updateOffer: update_offer failed');
    revalidatePath(`/angebote/${input.offerId}`);
    return { success: true, version: data };
  } catch (error) {
    logError('updateOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
