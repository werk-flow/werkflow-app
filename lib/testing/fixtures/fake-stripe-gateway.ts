import Stripe from 'stripe';

import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';

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
 * HTTP calls the fake answers from `answers` without the network. Signals are
 * checked for real against the secret the test generated.
 */
export function createFakeStripeGateway(
  webhookSecret: string,
  answers: FakeStripeAnswers = {},
  requests: FakeStripeRequests = [],
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
  return resolved.gateway;
}
