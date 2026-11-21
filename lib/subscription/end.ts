import 'server-only';

import { logError } from '@/lib/logging';
import { readOpenReservation, readOrganizationSubscription } from '@/lib/subscription/helpers';
import { recordSnapshot } from '@/lib/subscription/record';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';
import type { OrganizationSubscription } from '@/lib/subscription/helpers';

// Deleting an organization, or an account with an open reservation, first
// ends what Stripe bills for it (werk-flow/werkflow-planning#495): the open
// Checkout expires and every running subscription of its customer is
// cancelled at once, without proration or refund (owner, 2026-11-15). The
// fresh read of the stored subscription is recorded. Only then does the
// deletion run, so Stripe never debits a customer whose organization is gone;
// a failure refuses the deletion, and a retry cancels nothing twice. A
// subscription that still lands afterwards is refunded and cancelled by the
// backstop (record_werkflow_subscription_state, lib/subscription/record.ts).

export type EndSubscriptionsOutcome = { ok: true } | { ok: false; code: 'subscription_end_failed' };

async function endSubscriptionsOf(row: OrganizationSubscription | null): Promise<EndSubscriptionsOutcome> {
  if (!row) return { ok: true };
  const stripe = resolveStripeGateway();
  if (!stripe.ok) {
    logError('endSubscriptions: Stripe configuration refused', stripe.code);
    return { ok: false, code: 'subscription_end_failed' };
  }
  const { subscriptions } = stripe.gateway;
  try {
    await subscriptions.endCustomerSubscriptions(row.stripeCustomerId, row.checkoutSessionId);
    if (row.stripeSubscriptionId) {
      await recordSnapshot(
        row.organizationId,
        await subscriptions.readSubscription(row.stripeSubscriptionId),
      );
    }
    return { ok: true };
  } catch (failure) {
    logError('endSubscriptions: ending the subscription failed', failure);
    return { ok: false, code: 'subscription_end_failed' };
  }
}

/** Before an organization's deletion; the caller established the Admin. */
export async function endOrganizationSubscriptions(organizationId: string): Promise<EndSubscriptionsOutcome> {
  try {
    return await endSubscriptionsOf(await readOrganizationSubscription(organizationId));
  } catch {
    return { ok: false, code: 'subscription_end_failed' };
  }
}

/** Before an account's deletion: the reservation the person paid before their organization existed. */
export async function endReservedSubscriptions(userId: string): Promise<EndSubscriptionsOutcome> {
  try {
    return await endSubscriptionsOf(await readOpenReservation(userId));
  } catch {
    return { ok: false, code: 'subscription_end_failed' };
  }
}
