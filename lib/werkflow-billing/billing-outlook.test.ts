import { describe, expect, test } from 'bun:test';
import Stripe from 'stripe';

const { resolveStripeGateway } = await import('./stripe');

// The real gateway's billing-page calls (werk-flow/werkflow-planning#252),
// answered from memory: Stripe's objects become the page's next renewal and a
// payment method with no more than its last four digits, and a cancellation
// is Stripe's `cancel_at_period_end`, never an immediate cancel.

const PERIOD_END = Date.UTC(2026, 11, 15, 10) / 1000;

const subscription = (fields: Record<string, unknown> = {}) => ({
  id: 'sub_test_0001',
  object: 'subscription',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  cancellation_details: { reason: null },
  items: { object: 'list', data: [{ current_period_end: PERIOD_END }] },
  default_payment_method: null,
  customer: {
    id: 'cus_test_0001',
    object: 'customer',
    metadata: { werkflow_organization_id: '20000000-0000-4000-8000-00000000000a' },
    invoice_settings: {
      default_payment_method: {
        id: 'pm_test_sepa',
        type: 'sepa_debit',
        sepa_debit: { last4: '3000', country: 'DE' },
      },
    },
  },
  ...fields,
});

function gatewayAnswering(answers: Record<string, unknown>) {
  const requests: Array<{ key: string; body: string }> = [];
  const fetchFromMemory = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    requests.push({ key, body: typeof init?.body === 'string' ? decodeURIComponent(init.body) : '' });
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

describe("the billing page's Stripe calls", () => {
  test('a renewing subscription answers the preview amount at its period end and the customer default method by its last digits', async () => {
    const { calls, requests } = gatewayAnswering({
      'GET /v1/subscriptions/sub_test_0001': subscription(),
      'POST /v1/invoices/create_preview': { object: 'invoice', amount_due: 49900 },
    });
    expect(await calls.readBillingOutlook('sub_test_0001')).toEqual({
      upcoming: { amountCents: 49900, dueAt: '2026-12-15T10:00:00.000Z' },
      paymentMethod: { kind: 'sepa_debit', lastFour: '3000' },
    });
    expect(requests.at(-1)?.body).toContain('subscription=sub_test_0001');
  });

  test("a subscription that ends at its period end previews no renewal, and its own card wins over the customer's default", async () => {
    const { calls, requests } = gatewayAnswering({
      'GET /v1/subscriptions/sub_test_0001': subscription({
        cancel_at_period_end: true,
        default_payment_method: { id: 'pm_test_card', type: 'card', card: { brand: 'visa', last4: '4242' } },
      }),
    });
    expect(await calls.readBillingOutlook('sub_test_0001')).toEqual({
      upcoming: null,
      paymentMethod: { kind: 'card', brand: 'visa', lastFour: '4242' },
    });
    expect(requests.map((request) => request.key)).toEqual(['GET /v1/subscriptions/sub_test_0001']);
  });

  test('a cancellation set for a later date leaves the renewal before it, dated by the preview itself', async () => {
    // The subscription renewed between the two reads: the preview names its own, later payment date.
    const nextAttempt = PERIOD_END + 31 * 86_400;
    const { calls } = gatewayAnswering({
      'GET /v1/subscriptions/sub_test_0001': subscription({ cancel_at: PERIOD_END + 62 * 86_400 }),
      'POST /v1/invoices/create_preview': {
        object: 'invoice',
        amount_due: 49900,
        next_payment_attempt: nextAttempt,
      },
    });
    expect((await calls.readBillingOutlook('sub_test_0001')).upcoming).toEqual({
      amountCents: 49900,
      dueAt: new Date(nextAttempt * 1000).toISOString(),
    });
  });

  test('a cancellation set for the end of the current period previews no renewal', async () => {
    const { calls, requests } = gatewayAnswering({
      'GET /v1/subscriptions/sub_test_0001': subscription({ cancel_at: PERIOD_END }),
    });
    expect((await calls.readBillingOutlook('sub_test_0001')).upcoming).toBeNull();
    expect(requests.map((request) => request.key)).toEqual(['GET /v1/subscriptions/sub_test_0001']);
  });

  test("Stripe's refusal leaves the call as a stable code, without Stripe's message", async () => {
    const { calls } = gatewayAnswering({});
    await expect(calls.readBillingOutlook('sub_test_0001')).rejects.toMatchObject({
      code: 'stripe_call_failed',
    });
    await expect(calls.setCancelAtPeriodEnd('sub_test_0001', true)).rejects.toMatchObject({
      message: 'stripe_call_failed',
    });
  });

  test('cancelling sets only cancel_at_period_end', async () => {
    const { calls, requests } = gatewayAnswering({
      'POST /v1/subscriptions/sub_test_0001': subscription({ cancel_at_period_end: true }),
    });
    await calls.setCancelAtPeriodEnd('sub_test_0001', true);
    // Only the end of the period changes: no immediate cancel, no proration, no refund.
    expect(requests.map((request) => request.key)).toEqual(['POST /v1/subscriptions/sub_test_0001']);
    expect(requests[0]?.body).toBe('cancel_at_period_end=true');
  });
});
