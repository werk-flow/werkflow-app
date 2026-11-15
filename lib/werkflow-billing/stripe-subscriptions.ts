import 'server-only';

import { createHash } from 'node:crypto';

import type Stripe from 'stripe';

// The gateway's subscription calls (werk-flow/werkflow-planning#248): the
// Stripe customer of an organization, its Checkout, and the re-reads of the
// subscription that the signal handlers and the Checkout return trust instead
// of an event body. Stripe's own error never leaves a call: it can quote
// request data, so a failed call throws a stable code only.

/** The metadata key WerkFlow's server sets on every Stripe customer it creates. */
const ORGANIZATION_METADATA_KEY = 'werkflow_organization_id';

/** A subscription as Stripe holds it now. */
export type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  /** The customer's `werkflow_organization_id` metadata, unchecked; null when it has none. */
  organizationId: string | null;
  /** Stripe's status, such as `active` or `past_due`. */
  status: string;
  /** Why Stripe cancelled it, such as `payment_failed`; null while it runs. */
  cancellationReason: string | null;
  cancelAtPeriodEnd: boolean;
  /** When the paid period ends, as ISO time: the earliest end of its items. */
  currentPeriodEnd: string | null;
  /** When the read started, as ISO time: an older read never overwrites a newer one. */
  readAt: string;
};

type StripeCheckoutRequest = {
  customerId: string;
  organizationId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** closeOpenCheckouts' answer: calls that saw the same Checkouts get one session. */
  attempt: string;
};

export type StripeSubscriptionGateway = {
  /** Creates the customer of an organization, with its id in the metadata; answers the customer id. */
  createCustomer(input: {
    organizationId: string;
    email: string | null;
    name: string | null;
  }): Promise<string>;
  /**
   * Expires every open Checkout of the customer, so none can be paid any
   * more; a Checkout paid meanwhile refuses to expire and the call fails.
   * Answers a token naming the Checkouts it saw.
   */
  closeOpenCheckouts(customerId: string): Promise<string>;
  /** A Checkout for the monthly subscription by SEPA direct debit or card; answers its URL. */
  createCheckoutSession(input: StripeCheckoutRequest): Promise<string>;
  /** The subscription a completed Checkout started; null for another mode or an open Checkout. */
  readCheckoutSubscriptionId(sessionId: string): Promise<string | null>;
  readSubscription(subscriptionId: string): Promise<StripeSubscriptionSnapshot>;
  /** The customer's newest subscription, or null before the first. */
  readNewestSubscription(customerId: string): Promise<StripeSubscriptionSnapshot | null>;
};

function callFailed(): Error {
  return Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw callFailed();
  }
}

function expandableId(value: string | { id: string } | null): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

function subscriptionSnapshotOf(
  subscription: Stripe.Subscription,
  readAt: string,
): StripeSubscriptionSnapshot {
  const customer = subscription.customer;
  const organizationId =
    typeof customer === 'object' && !customer.deleted
      ? (customer.metadata[ORGANIZATION_METADATA_KEY] ?? null)
      : null;
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  return {
    id: subscription.id,
    customerId: expandableId(customer) ?? '',
    organizationId,
    status: subscription.status,
    cancellationReason: subscription.cancellation_details?.reason ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: periodEnds.length > 0 ? new Date(Math.min(...periodEnds) * 1000).toISOString() : null,
    readAt,
  };
}

export function subscriptionCalls(client: Stripe): StripeSubscriptionGateway {
  return {
    createCustomer: ({ organizationId, email, name }) =>
      call(async () => {
        const customer = await client.customers.create(
          {
            metadata: { [ORGANIZATION_METADATA_KEY]: organizationId },
            preferred_locales: ['de'],
            ...(email ? { email } : {}),
            ...(name ? { name } : {}),
          },
          // A retry after a lost answer gets the same customer.
          { idempotencyKey: `werkflow-customer-${organizationId}` },
        );
        return customer.id;
      }),
    closeOpenCheckouts: (customerId) =>
      call(async () => {
        const earlier = await client.checkout.sessions.list({ customer: customerId, limit: 100 });
        for (const session of earlier.data) {
          if (session.status === 'open') await client.checkout.sessions.expire(session.id);
        }
        const seen = earlier.data
          .map((session) => session.id)
          .sort()
          .join(',');
        return createHash('sha256').update(seen).digest('hex').slice(0, 32);
      }),
    createCheckoutSession: (request) =>
      call(async () => {
        const metadata = { [ORGANIZATION_METADATA_KEY]: request.organizationId };
        const session = await client.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: request.customerId,
            client_reference_id: request.organizationId,
            line_items: [{ price: request.priceId, quantity: 1 }],
            // offer.md: direct debit first, card as the alternative, nothing else.
            allowed_payment_method_types: ['sepa_debit', 'card'],
            // The invoice names the buyer's address (EN 16931); Checkout saves it on the customer.
            billing_address_collection: 'required',
            customer_update: { address: 'auto', name: 'auto' },
            locale: 'de',
            metadata,
            subscription_data: { metadata },
            success_url: request.successUrl,
            cancel_url: request.cancelUrl,
          },
          { idempotencyKey: `werkflow-checkout-${request.organizationId}-${request.attempt}` },
        );
        if (!session.url) throw callFailed();
        return session.url;
      }),
    readCheckoutSubscriptionId: (sessionId) =>
      call(async () => {
        const session = await client.checkout.sessions.retrieve(sessionId);
        if (session.mode !== 'subscription' || session.status !== 'complete') return null;
        return expandableId(session.subscription);
      }),
    readSubscription: (subscriptionId) =>
      call(async () => {
        const readAt = new Date().toISOString();
        return subscriptionSnapshotOf(
          await client.subscriptions.retrieve(subscriptionId, { expand: ['customer'] }),
          readAt,
        );
      }),
    readNewestSubscription: (customerId) =>
      call(async () => {
        const readAt = new Date().toISOString();
        const page = await client.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 1,
          expand: ['data.customer'],
        });
        const newest = page.data[0];
        return newest ? subscriptionSnapshotOf(newest, readAt) : null;
      }),
  };
}
