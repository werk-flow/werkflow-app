import 'server-only';

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
  /** begin_werkflow_checkout's attempt: a retry of one attempt gets its session, a new attempt a new one. */
  attempt: number;
};

/** A Checkout session WerkFlow hands to a payer. */
export type StripeCheckoutSession = { id: string; url: string; expiresAt: string };

type StripeCheckoutState = { open: boolean; subscriptionId: string | null };

export type StripeSubscriptionGateway = {
  /** Creates the customer of an organization, with its id in the metadata; answers the customer id. */
  createCustomer(input: {
    organizationId: string;
    email: string | null;
    name: string | null;
  }): Promise<string>;
  /** A Checkout for the monthly subscription by SEPA direct debit or card. */
  createCheckoutSession(input: StripeCheckoutRequest): Promise<StripeCheckoutSession>;
  /**
   * Leaves a Checkout unpayable: an open one expires. Answers the
   * subscription a completed one started, else null. A Checkout paid between
   * the read and the expiry refuses to expire, and the call fails.
   */
  closeCheckout(sessionId: string): Promise<string | null>;
  /**
   * A Checkout as Stripe holds it now: whether a payer can still pay it, and
   * the subscription it started once completed (null for another mode).
   */
  readCheckout(sessionId: string): Promise<StripeCheckoutState>;
  readSubscription(subscriptionId: string): Promise<StripeSubscriptionSnapshot>;
  /** The customer's newest subscription, or null before the first. */
  readNewestSubscription(customerId: string): Promise<StripeSubscriptionSnapshot | null>;
  /**
   * Ends a second subscription of an organization at once: refunds every
   * payment of its latest invoice that has no refund yet (a SEPA debit still
   * in flight is refunded when it settles), then cancels it without proration.
   * A rerun after a partial failure finishes the job.
   */
  cancelDuplicateSubscription(subscriptionId: string): Promise<void>;
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

function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | null {
  if (session.mode !== 'subscription' || session.status !== 'complete') return null;
  return expandableId(session.subscription);
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

/** cancelDuplicateSubscription's steps: each refund and the cancellation run at most once over reruns. */
async function cancelDuplicate(client: Stripe, subscriptionId: string): Promise<void> {
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  const invoiceId = expandableId(subscription.latest_invoice);
  // Every page of both lists: a payment left out would stay unrefunded once the subscription is cancelled.
  for await (const payment of invoiceId
    ? client.invoicePayments.list({ invoice: invoiceId, limit: 100 })
    : []) {
    const intentId = expandableId(payment.payment.payment_intent ?? null);
    if (!intentId || payment.status === 'canceled') continue;
    let refunded = false;
    for await (const refund of client.refunds.list({ payment_intent: intentId, limit: 100 })) {
      if (refund.status !== 'failed' && refund.status !== 'canceled') refunded = true;
    }
    if (!refunded) await client.refunds.create({ payment_intent: intentId });
  }
  if (subscription.status !== 'canceled') {
    await client.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
  }
}

export function subscriptionCalls(client: Stripe): StripeSubscriptionGateway {
  return {
    createCustomer: ({ organizationId, email, name }) =>
      call(async () => {
        // No idempotency key of our own: Stripe would replay a failure for a day. A customer
        // whose answer was lost stays unused, because begin_werkflow_checkout keeps the first stored one.
        const customer = await client.customers.create({
          metadata: { [ORGANIZATION_METADATA_KEY]: organizationId },
          preferred_locales: ['de'],
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
        });
        return customer.id;
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
        return {
          id: session.id,
          url: session.url,
          expiresAt: new Date(session.expires_at * 1000).toISOString(),
        };
      }),
    closeCheckout: (sessionId) =>
      call(async () => {
        const session = await client.checkout.sessions.retrieve(sessionId);
        if (session.status === 'open') {
          await client.checkout.sessions.expire(sessionId);
          return null;
        }
        return checkoutSubscriptionId(session);
      }),
    readCheckout: (sessionId) =>
      call(async () => {
        const session = await client.checkout.sessions.retrieve(sessionId);
        return { open: session.status === 'open', subscriptionId: checkoutSubscriptionId(session) };
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
    cancelDuplicateSubscription: (subscriptionId) => call(() => cancelDuplicate(client, subscriptionId)),
  };
}
