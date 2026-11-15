import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import type { StripeSubscriptionSnapshot } from '@/lib/werkflow-billing/stripe-subscriptions';
import { z } from '@/lib/zod';

// Records a subscription as Stripe reports it on a re-read, for the signal
// handlers (lib/werkflow-billing/signals/) and the Checkout return. The
// organization comes only from the Stripe customer's metadata, which
// WerkFlow's server set; record_werkflow_subscription_state checks that the
// organization's row holds that customer.

/** The database's refusals, kept as the signal's failure code. */
const REFUSALS = [
  'subscription_row_missing',
  'subscription_customer_mismatch',
  'subscription_conflict',
] as const;

const recordResultSchema = z.enum(['recorded', 'ignored']);

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** Throws a stable code on any failure, so a signal handler's Stripe retry runs it again. */
export async function recordSubscription(
  snapshot: StripeSubscriptionSnapshot,
): Promise<'recorded' | 'ignored'> {
  const organizationId = uuidSchema.safeParse(snapshot.organizationId);
  if (!organizationId.success) throw failure('organization_metadata_missing');

  const { data, error } = await createSupabaseAdminClient().rpc('record_werkflow_subscription_state', {
    p_organization_id: organizationId.data,
    p_stripe_customer_id: snapshot.customerId,
    p_stripe_subscription_id: snapshot.id,
    p_status: snapshot.status,
    p_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    p_read_at: snapshot.readAt,
    ...(snapshot.cancellationReason ? { p_cancellation_reason: snapshot.cancellationReason } : {}),
    ...(snapshot.currentPeriodEnd ? { p_current_period_end: snapshot.currentPeriodEnd } : {}),
  });
  if (error) {
    logError('recordSubscription: record_werkflow_subscription_state failed', error);
    throw failure(REFUSALS.find((code) => error.message.includes(code)) ?? 'subscription_record_failed');
  }
  const result = recordResultSchema.safeParse(data);
  if (!result.success) throw failure('subscription_record_failed');
  return result.data;
}
