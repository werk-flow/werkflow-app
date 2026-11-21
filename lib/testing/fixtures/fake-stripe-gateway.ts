import Stripe from 'stripe';

import { billingFailure } from '@/lib/werkflow-billing/failure';
import {
  resolveStripeGateway,
  type StripeBillingCustomer,
  type StripeGateway,
} from '@/lib/werkflow-billing/stripe';
import type {
  StripeSubscriptionGateway,
  StripeSubscriptionSnapshot,
} from '@/lib/werkflow-billing/stripe-subscriptions';

type Answer<Read extends 'readInvoice' | 'readMandate' | 'readDispute'> = Awaited<
  ReturnType<StripeGateway[Read]>
>;

/** What the fake's reads answer, by id; an id it does not hold fails as Stripe's read would. */
export type FakeStripeObjects = {
  invoices?: Record<string, Answer<'readInvoice'>>;
  customers?: Record<string, StripeBillingCustomer | null>;
  mandates?: Record<string, Answer<'readMandate'>>;
  disputes?: Record<string, Answer<'readDispute'>>;
};

async function lookup<T>(objects: Record<string, T> | undefined, id: string): Promise<T> {
  const found = objects?.[id];
  if (found === undefined) throw billingFailure('stripe_read_failed');
  return found;
}

/**
 * Answers for Stripe's API in memory: the response body of each request,
 * keyed by method and path without the query (`GET /v1/invoices/in_test_1`).
 * A request without an answer fails the test.
 */
export type FakeStripeAnswers = Readonly<Record<string, unknown>>;

/** Every request the fake answered, as method, path and query. */
export type FakeStripeRequests = Array<{ method: string; path: string; query: string }>;

/**
 * The gateway for tests: the real gateway with a synthetic test key, whose
 * HTTP calls the fake answers from `answers` without the network, and whose
 * billing reads answer `objects` by id. Signals are checked for real against
 * the secret the test generated.
 */
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
  /** The next Checkout create fails, and Stripe keeps that failure for its idempotency key. */
  failNextCheckout: boolean;
  /** The subscriptions cancelDuplicateSubscription refunded and cancelled. */
  cancelledDuplicates: string[];
  /** Every call fails as an unreachable Stripe would. */
  down: boolean;
  /** Runs once before the next call answers: what happens at Stripe meanwhile. */
  beforeNextCall: (() => Promise<void>) | null;
};

export function createFakeStripeBilling(): FakeStripeBilling {
  return {
    customers: new Map(),
    subscriptions: new Map(),
    checkoutSessions: new Map(),
    expiredCheckouts: [],
    checkoutRequests: [],
    failNextCheckout: false,
    cancelledDuplicates: [],
    down: false,
    beforeNextCall: null,
  };
}

/** Stripe's idempotency key: one session, or one cached failure, per organization and attempt. */
function checkoutSession(
  billing: FakeStripeBilling,
  failedKeys: Set<string>,
  request: Parameters<StripeSubscriptionGateway['createCheckoutSession']>[0],
) {
  const key = `${request.organizationId}-${request.attempt}`;
  if (billing.failNextCheckout) failedKeys.add(key);
  billing.failNextCheckout = false;
  if (failedKeys.has(key))
    throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
  let index = billing.checkoutRequests.findIndex(
    (earlier) => `${earlier.organizationId}-${earlier.attempt}` === key,
  );
  if (index < 0) {
    index = billing.checkoutRequests.push(request) - 1;
    billing.checkoutSessions.set(`cs_test_${index + 1}`, null);
  }
  const id = `cs_test_${index + 1}`;
  return {
    id,
    url: `https://checkout.stripe.test/c/pay/${id}`,
    expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
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
  const failedCheckoutKeys = new Set<string>();
  const reach = async <T>(answer: () => T): Promise<T> => {
    if (billing.down) throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
    const meanwhile = billing.beforeNextCall;
    billing.beforeNextCall = null;
    await meanwhile?.();
    return answer();
  };
  return {
    createCustomer: (input) =>
      reach(() => {
        // No idempotency key: every create is a new customer, as at Stripe.
        const id = `cus_test_${billing.customers.size + 1}`;
        billing.customers.set(id, input);
        return id;
      }),
    createCheckoutSession: (request) => reach(() => checkoutSession(billing, failedCheckoutKeys, request)),
    closeCheckout: (sessionId) =>
      reach(() => {
        const subscriptionId = billing.checkoutSessions.get(sessionId) ?? null;
        if (subscriptionId === null && !billing.expiredCheckouts.includes(sessionId)) {
          billing.expiredCheckouts.push(sessionId);
        }
        return subscriptionId;
      }),
    readCheckout: (sessionId) =>
      reach(() => {
        const subscriptionId = billing.checkoutSessions.get(sessionId) ?? null;
        return {
          open: subscriptionId === null && !billing.expiredCheckouts.includes(sessionId),
          subscriptionId,
        };
      }),
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
    cancelDuplicateSubscription: (subscriptionId) =>
      reach(() => {
        const subscription = billing.subscriptions.get(subscriptionId);
        if (!subscription)
          throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
        billing.cancelledDuplicates.push(subscriptionId);
        billing.subscriptions.set(subscriptionId, {
          ...subscription,
          status: 'canceled',
          cancellationReason: 'cancellation_requested',
        });
      }),
  };
}

/** What a test sets up; each part answers its own calls of the gateway. */
export type FakeStripeSetup = {
  /** readInvoice, readCustomer, readMandate and readDispute answer these by id. */
  objects?: FakeStripeObjects;
  /** The real gateway's HTTP calls (readInvoiceForIssue) are answered from these. */
  answers?: FakeStripeAnswers;
  /** Every HTTP request the fake answered is pushed here. */
  requests?: FakeStripeRequests;
  /** Stripe's customers, Checkouts and subscriptions for the subscription calls. */
  billing?: FakeStripeBilling;
};

export function createFakeStripeGateway(
  webhookSecret: string,
  { objects = {}, answers = {}, requests = [], billing = createFakeStripeBilling() }: FakeStripeSetup = {},
): StripeGateway {
  const fetchFromMemory = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    requests.push({ method, path: url.pathname, query: decodeURIComponent(url.search) });
    const key = `${method} ${url.pathname}`;
    if (!(key in answers)) {
      return Response.json(
        { error: { type: 'invalid_request_error', message: `No fake answer for ${key}` } },
        { status: 404 },
      );
    }
    return Response.json(answers[key]);
  };
  const resolved = resolveStripeGateway(
    { STRIPE_SECRET_KEY: 'sk_test_fake_gateway', STRIPE_WEBHOOK_SECRET: webhookSecret },
    Stripe.createFetchHttpClient(Object.assign(fetchFromMemory, { preconnect: fetch.preconnect })),
  );
  if (!resolved.ok) throw new Error(`The fake Stripe gateway was refused: ${resolved.code}`);
  return {
    verifySignal: resolved.gateway.verifySignal,
    readInvoiceForIssue: resolved.gateway.readInvoiceForIssue,
    readInvoice: (id) => lookup(objects.invoices, id),
    readCustomer: (id) => lookup(objects.customers, id),
    readMandate: (id) => lookup(objects.mandates, id),
    readDispute: (id) => lookup(objects.disputes, id),
    subscriptions: fakeSubscriptionCalls(billing),
  };
}
