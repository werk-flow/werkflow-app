import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';
import type {
  StripeSubscriptionGateway,
  StripeSubscriptionSnapshot,
} from '@/lib/werkflow-billing/stripe-subscriptions';

/**
 * Stripe's customers, Checkouts and subscriptions in memory, for the
 * subscription calls of the fake gateway (werk-flow/werkflow-planning#248).
 */
export type FakeStripeBilling = {
  customers: Map<string, { organizationId: string; email: string | null; name: string | null }>;
  /** Each subscription as Stripe holds it; a read stamps its own time. */
  subscriptions: Map<string, Omit<StripeSubscriptionSnapshot, 'readAt'>>;
  /** Each Checkout session by id, with the subscription it started; null while open. */
  checkoutSessions: Map<string, string | null>;
  /** The Checkouts a later Checkout expired. */
  expiredCheckouts: string[];
  checkoutRequests: Array<Parameters<StripeSubscriptionGateway['createCheckoutSession']>[0]>;
  /** Every call fails as an unreachable Stripe would. */
  down: boolean;
};

export function createFakeStripeBilling(): FakeStripeBilling {
  return {
    customers: new Map(),
    subscriptions: new Map(),
    checkoutSessions: new Map(),
    expiredCheckouts: [],
    checkoutRequests: [],
    down: false,
  };
}

/** The subscription calls of the fake gateway, for a fixture that replaces the gateway module itself. */
export function fakeSubscriptionCalls(billing: FakeStripeBilling): StripeSubscriptionGateway {
  // Each read is later than the one before, as Stripe's clock runs.
  let reads = 0;
  const stamped = (subscription: Omit<StripeSubscriptionSnapshot, 'readAt'>): StripeSubscriptionSnapshot => {
    reads += 1;
    return { ...subscription, readAt: new Date(Date.UTC(2026, 10, 15, 10, 0, reads)).toISOString() };
  };
  const reach = async <T>(answer: () => T): Promise<T> => {
    if (billing.down) throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
    return answer();
  };
  return {
    createCustomer: (input) =>
      reach(() => {
        // Stripe's idempotency key: a second create for one organization answers its customer.
        for (const [id, customer] of billing.customers) {
          if (customer.organizationId === input.organizationId) return id;
        }
        const id = `cus_test_${billing.customers.size + 1}`;
        billing.customers.set(id, input);
        return id;
      }),
    createCheckoutSession: (request) =>
      reach(() => {
        // Every open Checkout of the customer expires first.
        billing.checkoutRequests.forEach((earlier, index) => {
          const id = `cs_test_${index + 1}`;
          const open = billing.checkoutSessions.get(id) === null && !billing.expiredCheckouts.includes(id);
          if (earlier.customerId === request.customerId && open) billing.expiredCheckouts.push(id);
        });
        billing.checkoutRequests.push(request);
        const id = `cs_test_${billing.checkoutRequests.length}`;
        billing.checkoutSessions.set(id, null);
        return `https://checkout.stripe.test/c/pay/${id}`;
      }),
    readCheckoutSubscriptionId: (sessionId) => reach(() => billing.checkoutSessions.get(sessionId) ?? null),
    readSubscription: (subscriptionId) =>
      reach(() => {
        const subscription = billing.subscriptions.get(subscriptionId);
        if (!subscription)
          throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
        return stamped(subscription);
      }),
    readNewestSubscription: (customerId) =>
      reach(() => {
        const newest = [...billing.subscriptions.values()].findLast(
          (entry) => entry.customerId === customerId,
        );
        return newest ? stamped(newest) : null;
      }),
  };
}

/**
 * The gateway for tests: the real signal check against a secret the test
 * generated, and a synthetic test key that never reaches the network because
 * no call goes out. A child that adds a call to StripeGateway answers it here
 * with a fake, so no test reaches Stripe.
 */
export function createFakeStripeGateway(
  webhookSecret: string,
  billing: FakeStripeBilling = createFakeStripeBilling(),
): StripeGateway {
  const resolved = resolveStripeGateway({
    STRIPE_SECRET_KEY: 'sk_test_fake_gateway',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  if (!resolved.ok) throw new Error(`The fake Stripe gateway was refused: ${resolved.code}`);
  return { ...resolved.gateway, subscriptions: fakeSubscriptionCalls(billing) };
}
