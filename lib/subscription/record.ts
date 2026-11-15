import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readOrganizationSubscription } from '@/lib/subscription/helpers';
import { uuidSchema } from '@/lib/validation/uuid';
import type {
  StripeSubscriptionGateway,
  StripeSubscriptionSnapshot,
} from '@/lib/werkflow-billing/stripe-subscriptions';
import { z } from '@/lib/zod';

// Records a subscription as Stripe reports it on a re-read, for the signal
// handlers (lib/werkflow-billing/signals/) and the Checkout return. The
// organization comes only from the Stripe customer's metadata, which
// WerkFlow's server set; record_werkflow_subscription_state checks that the
// organization's row holds that customer.
//
// One subscription per organization: when a second one lands while the
// first holds, both are re-read from Stripe. If both still hold, the call
// that records the fresh read of the newcomer marks it a duplicate under the
// organization's row lock (`p_refuse_as_duplicate`), and the database never
// lets a marked subscription replace the organization's one. Only a
// subscription the database answers 'duplicate' is refunded and cancelled,
// at once, and the call throws `duplicate_subscription_cancelled`, which the
// signal ledger keeps (werkflow_billing_signals.last_failure_code) for a
// person to see. Stripe's next delivery then finds the newcomer cancelled and
// settles. This is the backstop behind the Checkout lock
// (begin_werkflow_checkout).

/** The database's refusals, kept as the signal's failure code. */
const REFUSALS = [
  'subscription_row_missing',
  'subscription_customer_mismatch',
  'subscription_conflict',
] as const;

const recordResultSchema = z.enum(['recorded', 'ignored', 'duplicate']);

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function recordSnapshot(
  organizationId: string,
  snapshot: StripeSubscriptionSnapshot,
  refuseAsDuplicate = false,
): Promise<z.infer<typeof recordResultSchema>> {
  const { data, error } = await createSupabaseAdminClient().rpc('record_werkflow_subscription_state', {
    p_organization_id: organizationId,
    p_stripe_customer_id: snapshot.customerId,
    p_stripe_subscription_id: snapshot.id,
    p_status: snapshot.status,
    p_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    p_read_at: snapshot.readAt,
    ...(snapshot.cancellationReason ? { p_cancellation_reason: snapshot.cancellationReason } : {}),
    ...(snapshot.currentPeriodEnd ? { p_current_period_end: snapshot.currentPeriodEnd } : {}),
    ...(refuseAsDuplicate ? { p_refuse_as_duplicate: true } : {}),
  });
  if (error) {
    logError('recordSubscription: record_werkflow_subscription_state failed', error);
    throw failure(REFUSALS.find((code) => error.message.includes(code)) ?? 'subscription_record_failed');
  }
  const result = recordResultSchema.safeParse(data);
  if (!result.success) throw failure('subscription_record_failed');
  return result.data;
}

const isConflict = (error: unknown) =>
  error instanceof Error && Reflect.get(error, 'code') === 'subscription_conflict';

/** Refunds and cancels a subscription only when the database marked it a duplicate. */
async function settle(
  outcome: z.infer<typeof recordResultSchema>,
  subscriptionId: string,
  stripe: StripeSubscriptionGateway,
): Promise<'recorded' | 'ignored'> {
  if (outcome !== 'duplicate') return outcome;
  await stripe.cancelDuplicateSubscription(subscriptionId);
  logError('recordSubscription: a second subscription was refunded and cancelled', 'duplicate_subscription');
  throw failure('duplicate_subscription_cancelled');
}

/** Throws a stable code on any failure, so a signal handler's Stripe retry runs it again. */
export async function recordSubscription(
  snapshot: StripeSubscriptionSnapshot,
  stripe: StripeSubscriptionGateway,
): Promise<'recorded' | 'ignored'> {
  const organizationId = uuidSchema.safeParse(snapshot.organizationId);
  if (!organizationId.success) throw failure('organization_metadata_missing');
  try {
    return await settle(await recordSnapshot(organizationId.data, snapshot), snapshot.id, stripe);
  } catch (error) {
    if (!isConflict(error)) throw error;
  }

  // Judge neither subscription on a stale read: the stored one may have ended meanwhile.
  const stored = await readOrganizationSubscription(organizationId.data);
  if (stored?.stripeSubscriptionId) {
    await recordSnapshot(organizationId.data, await stripe.readSubscription(stored.stripeSubscriptionId));
  }
  const fresh = await stripe.readSubscription(snapshot.id);
  return settle(await recordSnapshot(organizationId.data, fresh, true), snapshot.id, stripe);
}
