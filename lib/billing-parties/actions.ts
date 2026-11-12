'use server';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { BILLING_WORK_KINDS } from './types';

// The refusals set_work_billing_parties raises
// (supabase/migrations/20261130090005_keep_work_auftraggeber_and_frozen_recipient.sql).
const partiesWriteRefusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'work_not_found',
    'request_not_editable',
    'client_required',
    'client_not_found',
    'recipient_not_found',
    'client_archived',
  ]),
);

const setArgumentsSchema = z.object({
  kind: z.enum(BILLING_WORK_KINDS),
  workId: uuidSchema,
  clientId: uuidSchema,
  recipientClientId: uuidSchema,
});

/**
 * The office chooses the Auftraggeber and the Rechnungsempfänger of one work.
 * The recipient's name and address are copied now; the previous choice stays
 * in the work's history. Saving the same customers again takes their current
 * name and address.
 */
export async function setWorkBillingParties(
  rawInput: z.input<typeof setArgumentsSchema>,
): Promise<ActionResult> {
  const parsed = setArgumentsSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    // The function finds the work and both customers in the caller's
    // organization and checks the caller's role again under its lock.
    const { data, error } = await createSupabaseAdminClient().rpc('set_work_billing_parties', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_kind: input.kind,
      p_work_id: input.workId,
      p_client_id: input.clientId,
      p_recipient_client_id: input.recipientClientId,
    });
    if (error || !data)
      return partiesWriteRefusal(error, 'save_failed', 'setWorkBillingParties: save failed');
    return { success: true };
  } catch (error) {
    logError('Unexpected error in setWorkBillingParties:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
