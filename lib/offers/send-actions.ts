'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveManagerContext } from '@/lib/org/manager-context';
import type { SendOfferInput } from './action-schemas';
import { recordOfferSent, type OfferSent } from './sending';

// Admin and Büro record a draft as sent (lib/offers/sending.ts). The action
// resolves the caller's organization and manager role on the server and
// passes only those; send_offer checks the actor again.

/** „Als gesendet festhalten“: freezes the saved draft as its next revision and files its PDF. */
export async function sendOffer(rawInput: SendOfferInput): Promise<ActionResult<OfferSent>> {
  try {
    const caller = await resolveManagerContext();
    if (!caller.success) return caller;
    const result = await recordOfferSent(caller.context, rawInput);
    // The page renders the sent offer into this answer; another session hears it through Realtime.
    if (result.success) revalidatePath(`/angebote/${result.offerId}`);
    return result;
  } catch (error) {
    logError('sendOffer: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
