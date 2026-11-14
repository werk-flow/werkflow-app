'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { createOfferSchema, type CreateOfferInput } from './action-schemas';

// Admin and Büro keep the offers. Every action resolves the caller's
// organization and manager role on the server and passes only those; the
// database function checks the actor again, refuses every id outside the
// organization and writes the history in the same call
// (supabase/migrations/20261204100000_keep_offers_for_the_right_customer_and_recipient.sql).

const createRefusal = writeRefusalFor(
  new Set(['not_authorized', 'client_not_found', 'client_archived', 'site_not_found', 'contact_not_found']),
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
