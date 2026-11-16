import { describe, expect, mock, test } from 'bun:test';
import Stripe from 'stripe';

mock.module('server-only', () => ({}));
const { resolveStripeGateway } = await import('./stripe');

// The real gateway's calls that end subscriptions (werk-flow/werkflow-planning#495),
// answered from memory: a deleted organization's customer loses its open
// Checkout and every subscription Stripe still bills, without a refund; the
// duplicate cleanup refunds each payment once, and a refund that was
// cancelled is issued again under a new idempotency key.

type SentRequest = { key: string; body: string; idempotencyKey: string | null };

function gatewayAnswering(answers: Record<string, unknown>) {
  const requests: SentRequest[] = [];
  const fetchFromMemory = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    requests.push({
      key,
      // A DELETE carries its parameters in the query.
      body: decodeURIComponent(typeof init?.body === 'string' ? init.body : url.search),
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    });
    if (!(key in answers))
      return Response.json({ error: { message: `No answer for ${key}` } }, { status: 404 });
    return Response.json(answers[key]);
  };
  const resolved = resolveStripeGateway(
    { STRIPE_SECRET_KEY: 'sk_test_synthetic0000', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic0000' },
    Stripe.createFetchHttpClient(Object.assign(fetchFromMemory, { preconnect: fetch.preconnect })),
  );
  if (!resolved.ok) throw new Error(resolved.code);
  return { calls: resolved.gateway.subscriptions, requests };
}

const list = (data: unknown[]) => ({ object: 'list', has_more: false, data });
const subscription = (id: string, status: string) => ({ id, object: 'subscription', status });

describe('ending subscriptions at Stripe', () => {
  test('a deleted customer loses its open Checkout and each running subscription, without proration or refund', async () => {
    const { calls, requests } = gatewayAnswering({
      'GET /v1/checkout/sessions/cs_test_open': {
        id: 'cs_test_open',
        object: 'checkout.session',
        status: 'open',
      },
      'POST /v1/checkout/sessions/cs_test_open/expire': { id: 'cs_test_open', status: 'expired' },
      'GET /v1/subscriptions': list([
        subscription('sub_test_running', 'past_due'),
        subscription('sub_test_ended', 'canceled'),
      ]),
      'DELETE /v1/subscriptions/sub_test_running': subscription('sub_test_running', 'canceled'),
    });
    expect(await calls.endCustomerSubscriptions('cus_test_0001', 'cs_test_open')).toEqual([
      'sub_test_running',
    ]);
    expect(requests.map((request) => request.key)).toEqual([
      'GET /v1/checkout/sessions/cs_test_open',
      'POST /v1/checkout/sessions/cs_test_open/expire',
      'GET /v1/subscriptions',
      'DELETE /v1/subscriptions/sub_test_running',
    ]);
    expect(requests.at(-1)?.body).toContain('prorate=false');
    expect(requests.some((request) => request.key.includes('refunds'))).toBe(false);
  });

  test('a duplicate whose refund was cancelled is refunded again under a new key, and one with a refund is not', async () => {
    const answers = {
      'GET /v1/subscriptions/sub_test_dup': {
        ...subscription('sub_test_dup', 'canceled'),
        latest_invoice: 'in_test_1',
      },
      'GET /v1/invoice_payments': list([
        {
          id: 'inpay_test_1',
          object: 'invoice_payment',
          status: 'paid',
          payment: { payment_intent: 'pi_test_1' },
        },
      ]),
      'GET /v1/refunds': list([{ id: 're_test_1', object: 'refund', status: 'canceled' }]),
      'POST /v1/refunds': { id: 're_test_2', object: 'refund', status: 'pending' },
    };
    const cancelledOnce = gatewayAnswering(answers);
    await cancelledOnce.calls.cancelDuplicateSubscription('sub_test_dup');
    const created = cancelledOnce.requests.find((request) => request.key === 'POST /v1/refunds');
    expect(created?.idempotencyKey).toBe('werkflow-duplicate-refund-pi_test_1-1');
    expect(created?.body).toContain('metadata[werkflow_duplicate_subscription_id]=sub_test_dup');

    const pending = gatewayAnswering({
      ...answers,
      'GET /v1/refunds': list([{ id: 're_test_2', object: 'refund', status: 'failed' }]),
    });
    await pending.calls.cancelDuplicateSubscription('sub_test_dup');
    expect(pending.requests.some((request) => request.key === 'POST /v1/refunds')).toBe(false);
  });
});
