import { describe, expect, test } from 'bun:test';
import Stripe from 'stripe';

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

  test('a cleanup cut short reuses its refund key, a cancelled refund gets a new one, and the duplicate ends only after a live refund', async () => {
    const answers: Record<string, unknown> = {
      'GET /v1/subscriptions/sub_test_dup': {
        ...subscription('sub_test_dup', 'active'),
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
      'GET /v1/refunds': list([]),
      'POST /v1/refunds': { id: 're_test_1', object: 'refund', status: 'pending' },
      // No answer for the cancellation yet: Stripe refuses it, and the cleanup fails after its refund.
    };
    const { calls, requests } = gatewayAnswering(answers);
    const refundKeys = () =>
      requests
        .filter((request) => request.key === 'POST /v1/refunds')
        .map((request) => request.idempotencyKey);
    const cancellations = () =>
      requests.filter((request) => request.key === 'DELETE /v1/subscriptions/sub_test_dup');

    // The first attempt issues its refund, then the cancellation fails.
    await expect(calls.cancelDuplicateSubscription('sub_test_dup')).rejects.toThrow('stripe_call_failed');
    expect(refundKeys()).toEqual(['werkflow-duplicate-refund-pi_test_1-0']);
    expect(requests.find((request) => request.key === 'POST /v1/refunds')?.body).toContain(
      'metadata[werkflow_duplicate_subscription_id]=sub_test_dup',
    );

    // A retry whose create answer was lost reuses the attempt's key, so Stripe replays one refund.
    await expect(calls.cancelDuplicateSubscription('sub_test_dup')).rejects.toThrow('stripe_call_failed');
    expect(refundKeys()).toEqual([
      'werkflow-duplicate-refund-pi_test_1-0',
      'werkflow-duplicate-refund-pi_test_1-0',
    ]);

    // Stripe lists the refund as pending: the retry issues none, and the cancellation still fails.
    answers['GET /v1/refunds'] = list([{ id: 're_test_1', object: 'refund', status: 'pending' }]);
    await expect(calls.cancelDuplicateSubscription('sub_test_dup')).rejects.toThrow('stripe_call_failed');
    expect(refundKeys()).toHaveLength(2);

    // The refund was cancelled meanwhile: the next attempt issues a new one under a new key, then ends the duplicate.
    answers['GET /v1/refunds'] = list([{ id: 're_test_1', object: 'refund', status: 'canceled' }]);
    answers['POST /v1/refunds'] = { id: 're_test_2', object: 'refund', status: 'pending' };
    answers['DELETE /v1/subscriptions/sub_test_dup'] = subscription('sub_test_dup', 'canceled');
    await calls.cancelDuplicateSubscription('sub_test_dup');
    expect(refundKeys().at(-1)).toBe('werkflow-duplicate-refund-pi_test_1-1');
    expect(cancellations()).toHaveLength(4);
    const lastRefund = requests.findLastIndex((request) => request.key === 'POST /v1/refunds');
    const lastCancellation = requests.findLastIndex(
      (request) => request.key === 'DELETE /v1/subscriptions/sub_test_dup',
    );
    expect(lastRefund).toBeLessThan(lastCancellation);

    // A refund Stripe reported failed is a person's to repeat: no new refund.
    answers['GET /v1/refunds'] = list([{ id: 're_test_2', object: 'refund', status: 'failed' }]);
    answers['GET /v1/subscriptions/sub_test_dup'] = {
      ...subscription('sub_test_dup', 'canceled'),
      latest_invoice: 'in_test_1',
    };
    const before = refundKeys().length;
    await calls.cancelDuplicateSubscription('sub_test_dup');
    expect(refundKeys()).toHaveLength(before);
  });
});
