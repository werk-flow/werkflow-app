import 'server-only';

import { logError } from '@/lib/logging';
import { raiseBillingAlarm } from '@/lib/werkflow-billing/mail-delivery';
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
// first runs, both are re-read from Stripe. If both still run, the call
// that records the fresh read of the newcomer marks it a duplicate under the
// organization's row lock (`p_refuse_as_duplicate`), and the database never
// lets a marked subscription replace the organization's one. The database
// also marks a running subscription whose organization or account is gone.
// Only a subscription the database answers 'duplicate' is refunded and
// cancelled, at once; then the `duplicate_subscription_cancelled` alarm
// reaches a person, and the cleanup is settled. Until then every delivery of
// the duplicate answers 'duplicate' and resumes the cleanup, also once it was
// cancelled outside WerkFlow. This is the backstop behind the Checkout lock
// (begin_werkflow_checkout) and the cancellation on deletion (end.ts).

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

/**
 * One record call for a fresh read. The billing page's cancellation records
 * the organization's own stored subscription through it: that one can never
 * be a second subscription, so it needs none of recordSubscription's conflict steps.
 */
export async function recordSnapshot(
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

/**
 * Refunds and cancels a subscription only when the database marked it a
 * duplicate, raises the alarm, then settles the cleanup. A failed step throws,
 * and the next delivery resumes it: each step runs at most once over reruns.
 */
async function settle(
  outcome: z.infer<typeof recordResultSchema>,
  organizationId: string,
  subscriptionId: string,
  stripe: StripeSubscriptionGateway,
): Promise<'recorded' | 'ignored'> {
  if (outcome !== 'duplicate') return outcome;
  await stripe.cancelDuplicateSubscription(subscriptionId);
  const stored = await readOrganizationSubscription(organizationId);
  await raiseBillingAlarm({
    kind: 'duplicate_subscription_cancelled',
    stripeObjectId: subscriptionId,
    facts: [
      ['Organisation', organizationId],
      ['Behaltenes Abo', stored?.stripeSubscriptionId ?? 'keins'],
    ],
  });
  const { error } = await createSupabaseAdminClient().rpc('settle_werkflow_duplicate_subscription', {
    p_organization_id: organizationId,
    p_stripe_subscription_id: subscriptionId,
  });
  if (error) {
    logError('recordSubscription: settle_werkflow_duplicate_subscription failed', error);
    throw failure('subscription_record_failed');
  }
  return 'ignored';
}

/**
 * Records a refund of a marked duplicate that Stripe reported failed, against
 * the duplicate and its payment (signals/refund.ts). Throws a stable code.
 */
export async function recordRefundFailure(input: {
  organizationId: string;
  subscriptionId: string;
  refundId: string;
  paymentIntentId: string;
}): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc('record_werkflow_refund_failure', {
    p_organization_id: input.organizationId,
    p_stripe_subscription_id: input.subscriptionId,
    p_stripe_refund_id: input.refundId,
    p_stripe_payment_intent_id: input.paymentIntentId,
  });
  if (error) {
    logError('recordRefundFailure: record_werkflow_refund_failure failed', error);
    throw failure(error.message.includes('duplicate_unknown') ? 'duplicate_unknown' : 'refund_record_failed');
  }
}

/** Throws a stable code on any failure, so a signal handler's Stripe retry runs it again. */
export async function recordSubscription(
  snapshot: StripeSubscriptionSnapshot,
  stripe: StripeSubscriptionGateway,
): Promise<'recorded' | 'ignored'> {
  const organizationId = uuidSchema.safeParse(snapshot.organizationId);
  if (!organizationId.success) throw failure('organization_metadata_missing');
  try {
    return await settle(
      await recordSnapshot(organizationId.data, snapshot),
      organizationId.data,
      snapshot.id,
      stripe,
    );
  } catch (error) {
    if (!isConflict(error)) throw error;
  }

  // Judge neither subscription on a stale read: the stored one may have ended meanwhile.
  const stored = await readOrganizationSubscription(organizationId.data);
  if (stored?.stripeSubscriptionId) {
    await recordSnapshot(organizationId.data, await stripe.readSubscription(stored.stripeSubscriptionId));
  }
  const fresh = await stripe.readSubscription(snapshot.id);
  return settle(
    await recordSnapshot(organizationId.data, fresh, true),
    organizationId.data,
    snapshot.id,
    stripe,
  );
}
