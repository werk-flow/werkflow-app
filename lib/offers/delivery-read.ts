'use server';

import type { ActionResult } from '@/lib/action-result';
import { resolveManagerContext } from '@/lib/org/manager-context';
import type { z } from '@/lib/zod';

import { readOfferRevisionDelivery } from './delivery';
import { offerRevisionRefSchema, type OfferRevisionDelivery } from './delivery-types';

// „Versand“ of a sent offer revision, apart from the send actions, so the
// background read registry loads no sending code.

/** One revision's deliveries and what the email form proposes; Admin and Büro only. */
export async function getOfferRevisionDelivery(
  input: z.input<typeof offerRevisionRefSchema>,
): Promise<ActionResult<{ delivery: OfferRevisionDelivery }>> {
  const parsed = offerRevisionRefSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveManagerContext();
  if (!caller.success) return caller;
  return readOfferRevisionDelivery(caller.context, parsed.data);
}
