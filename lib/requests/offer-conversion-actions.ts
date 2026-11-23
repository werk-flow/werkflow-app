'use server';

import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { rowWriteResultFor } from '@/lib/supabase/write-refusal';
import { blankableUuidSchema } from '@/lib/jobs/action-schemas';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { ConvertRequestToOfferResult } from './types';

const convertToOfferArgumentsSchema = z.object({
  requestId: uuidSchema,
  attemptKey: uuidSchema,
  input: z.object({
    // The customer the dialog showed; the request must still have it.
    clientId: uuidSchema,
    // The offer title's own limit (offers_title_check); a blank one reaches title_required.
    title: z.string().max(200),
    siteId: blankableUuidSchema.optional(),
    contactId: blankableUuidSchema.optional(),
  }),
});

// The refusals of convert_client_request_to_offer, each an action failure code.
const offerConversionResult = rowWriteResultFor(
  new Set([
    'not_authorized',
    'request_not_found',
    'already_converted',
    'client_required',
    'request_changed',
    'client_archived',
    'title_required',
    'site_not_found',
    'contact_not_found',
  ]),
  (offer: { id: string; offer_number: string }) => ({ offerId: offer.id, offerNumber: offer.offer_number }),
);

/**
 * Converts an open request with a customer into an offer draft, once. One call
 * creates the offer for the request's customer, which must still be the
 * `clientId` the dialog showed, at the chosen Objekt and
 * Ansprechpartner, carries the recipient the office chose on the request,
 * marks the request converted, links its documents to the offer and records
 * the request history, or refuses and changes nothing. A retry under
 * `attemptKey` answers with the first offer; any other second conversion is
 * refused.
 */
export async function convertRequestToOffer(
  rawRequestId: string,
  rawInput: { clientId: string; title: string; siteId?: string; contactId?: string },
  rawAttemptKey: string,
): Promise<ConvertRequestToOfferResult> {
  const parsedArguments = convertToOfferArgumentsSchema.safeParse({
    requestId: rawRequestId,
    input: rawInput,
    attemptKey: rawAttemptKey,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input, attemptKey } = parsedArguments.data;
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId, userId } = caller.context;

    // The function checks the actor, the request, its customer, Objekt and
    // Ansprechpartner under their locks; the organization comes from the
    // session, never from the client.
    const outcome = await createSupabaseAdminClient().rpc(
      'convert_client_request_to_offer',
      rpcArgs('convert_client_request_to_offer', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_request_id: requestId,
        p_attempt_key: attemptKey,
        p_client_id: input.clientId,
        p_title: input.title,
        p_site_id: input.siteId || null,
        p_contact_id: input.contactId || null,
      }),
    );
    return offerConversionResult(outcome, 'create_failed', 'convertRequestToOffer: conversion failed');
  } catch (error) {
    logError('convertRequestToOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
