import Stripe from 'stripe';

import { billingFailure } from '@/lib/werkflow-billing/failure';
import {
  resolveStripeGateway,
  type StripeBillingCustomer,
  type StripeGateway,
} from '@/lib/werkflow-billing/stripe';

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
/** What a test sets up; each part answers its own calls of the gateway. */
export type FakeStripeSetup = {
  /** readInvoice, readCustomer, readMandate and readDispute answer these by id. */
  objects?: FakeStripeObjects;
  /** The real gateway's HTTP calls (readInvoiceForIssue) are answered from these. */
  answers?: FakeStripeAnswers;
  /** Every HTTP request the fake answered is pushed here. */
  requests?: FakeStripeRequests;
};

export function createFakeStripeGateway(
  webhookSecret: string,
  { objects = {}, answers = {}, requests = [] }: FakeStripeSetup = {},
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
  };
}
