import 'server-only';

import type Stripe from 'stripe';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { signalFamilyFor } from '@/lib/werkflow-billing/signals/dispatch';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// Handles one verified Stripe signal at most once (werk-flow/werkflow-planning#250).
// One database call records the event id and claims it; a settled event or one
// another delivery holds runs nothing. The family's handler runs, and its
// outcome settles the row: handled, ignored for a type no family takes, or
// failed, which releases the claim so Stripe's next delivery runs it again.

/** What the endpoint answers: 200, 400, 409, 500 or 503 (route.ts). */
export type SignalReceipt = 'settled' | 'malformed' | 'busy' | 'failed' | 'unavailable';

// The fields the ledger keeps, checked even though Stripe signed them: they
// reach a database column.
const signalLedgerFieldsSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]{1,250}$/),
  type: z.string().regex(/^[a-z0-9_.]{1,120}$/),
  created: z.number().int().positive(),
});

const FAILURE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A thrown error's own stable code, or a generic one; never its message. */
function handlerFailureCode(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' && FAILURE_CODE.test(code) ? code : 'handler_failed';
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function settleSignal(
  admin: Admin,
  eventId: string,
  outcome: 'handled' | 'ignored' | 'failed',
  failureCode?: string,
): Promise<boolean> {
  const { error } = await admin.rpc('settle_werkflow_billing_signal', {
    p_stripe_event_id: eventId,
    p_outcome: outcome,
    ...(failureCode ? { p_failure_code: failureCode } : {}),
  });
  if (error) logError('receiveSignal: settle_werkflow_billing_signal failed', error);
  return !error;
}

export async function receiveSignal(event: Stripe.Event, stripe: StripeGateway): Promise<SignalReceipt> {
  const fields = signalLedgerFieldsSchema.safeParse(event);
  if (!fields.success) return 'malformed';
  const { id, type, created } = fields.data;

  const admin = createSupabaseAdminClient();
  const { data: claim, error } = await admin.rpc('claim_werkflow_billing_signal', {
    p_stripe_event_id: id,
    p_event_type: type,
    p_stripe_created_at: new Date(created * 1000).toISOString(),
  });
  if (error) {
    logError('receiveSignal: claim_werkflow_billing_signal failed', error);
    return 'unavailable';
  }
  if (claim === 'settled' || claim === 'busy') return claim;
  if (claim !== 'claimed') {
    logError('receiveSignal: unexpected claim result', 'invalid_result');
    return 'unavailable';
  }

  const family = signalFamilyFor(type);
  if (!family) return (await settleSignal(admin, id, 'ignored')) ? 'settled' : 'unavailable';

  try {
    await family.handle(event, stripe);
  } catch (handlerError) {
    logError('receiveSignal: signal handler failed', handlerError);
    await settleSignal(admin, id, 'failed', handlerFailureCode(handlerError));
    return 'failed';
  }
  return (await settleSignal(admin, id, 'handled')) ? 'settled' : 'unavailable';
}
