import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

mock.module('server-only', () => ({}));
// Signing and Stripe's verification both read the clock; a fixed instant keeps them in step.
beforeAll(() => setSystemTime(new Date('2026-03-02T08:00:00Z')));
afterAll(() => setSystemTime());
const { resolveStripeGateway } = await import('./stripe');
const { failedPaymentMethodType } = await import('./payment-method');
const { createFakeStripeGateway } = await import('@/lib/testing/fixtures/fake-stripe-gateway');
const { signalFamilyFor } = await import('./signals/dispatch');

// Synthetic values of the right form; no real key exists in this repository.
const TEST_KEY = 'sk_test_synthetic0000';
const LIVE_KEY = 'sk_live_synthetic0000';
const WEBHOOK_SECRET = 'whsec_synthetic0000';

describe('the key guard: live Stripe is PROD', () => {
  test('a live key outside production is refused', () => {
    for (const vercelEnv of [undefined, 'preview', 'development']) {
      expect(
        resolveStripeGateway({
          STRIPE_SECRET_KEY: LIVE_KEY,
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
          VERCEL_ENV: vercelEnv,
        }),
      ).toEqual({ ok: false, code: 'stripe_live_key_outside_production' });
    }
    expect(
      resolveStripeGateway({
        STRIPE_SECRET_KEY: 'rk_live_synthetic0000',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }),
    ).toEqual({ ok: false, code: 'stripe_live_key_outside_production' });
  });

  test('a test key in production is refused', () => {
    expect(
      resolveStripeGateway({
        STRIPE_SECRET_KEY: TEST_KEY,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        VERCEL_ENV: 'production',
      }),
    ).toEqual({ ok: false, code: 'stripe_test_key_in_production' });
  });

  test('a missing or unknown key or webhook secret is a typed failure, not a crash', () => {
    expect(resolveStripeGateway({})).toEqual({ ok: false, code: 'stripe_secret_key_missing' });
    expect(resolveStripeGateway({ STRIPE_SECRET_KEY: '  ' })).toEqual({
      ok: false,
      code: 'stripe_secret_key_missing',
    });
    expect(resolveStripeGateway({ STRIPE_SECRET_KEY: 'pk_test_synthetic0000' })).toEqual({
      ok: false,
      code: 'stripe_secret_key_unrecognized',
    });
    expect(resolveStripeGateway({ STRIPE_SECRET_KEY: TEST_KEY })).toEqual({
      ok: false,
      code: 'stripe_webhook_secret_missing',
    });
  });

  test('the matching key gives a gateway in each environment', () => {
    expect(
      resolveStripeGateway({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }).ok,
    ).toBe(true);
    const production = resolveStripeGateway({
      STRIPE_SECRET_KEY: LIVE_KEY,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      VERCEL_ENV: 'production',
    });
    expect(production.ok).toBe(true);
  });
});

describe('the fake gateway verifies a signal as Stripe does', () => {
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const payload = JSON.stringify({
    id: 'evt_test_fake_1',
    object: 'event',
    type: 'invoice.paid',
    created: 1,
  });
  const fake = createFakeStripeGateway(secret);

  test('a signal signed with the secret is accepted', async () => {
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    expect((await fake.verifySignal(payload, signature))?.id).toBe('evt_test_fake_1');
  });

  test('a forged, stale or altered signal is refused', async () => {
    const forged = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'whsec_other' });
    const stale = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret,
      // Long past Stripe's five-minute tolerance.
      timestamp: 1_000_000_000,
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    expect(await fake.verifySignal(payload, forged)).toBeNull();
    expect(await fake.verifySignal(payload, stale)).toBeNull();
    expect(await fake.verifySignal(payload.replace('invoice.paid', 'invoice.voided'), signature)).toBeNull();
    expect(await fake.verifySignal(payload, '')).toBeNull();
  });
});

describe('the dispatch table', () => {
  // Each family's own test proves its handler (billing-mails.test.ts for payment and mandate signals,
  // issue-invoice.test.ts for invoices, subscription-signals.test.ts for checkout and subscription signals).
  test('each stage A family takes its types, an invoice signal without an invoice is refused, and an unknown type has none', async () => {
    const fake = createFakeStripeGateway(WEBHOOK_SECRET);
    // invoice.finalized and invoice.paid issue an invoice (issue-invoice.test.ts); an event without one is refused.
    for (const eventType of ['invoice.finalized', 'invoice.paid'] as const) {
      const event = Stripe.webhooks.constructEventWithoutVerification(
        JSON.stringify({
          id: 'evt_test_dispatch',
          object: 'event',
          type: eventType,
          created: 1,
          data: { object: {} },
        }),
      );
      await expect(signalFamilyFor(eventType)?.handle(event, fake)).rejects.toMatchObject({
        code: 'werkflow_invoice_unreadable',
      });
    }
    const stageA = [
      'invoice.payment_failed',
      'charge.dispute.created',
      'credit_note.created',
      'mandate.updated',
      'checkout.session.completed',
      'customer.subscription.updated',
    ] as const;
    for (const eventType of stageA) {
      const family = signalFamilyFor(eventType);
      expect(family?.eventTypes, eventType).toContain(eventType);
    }
    expect(signalFamilyFor('customer.created')).toBeUndefined();
  });
});

describe('the failed payment method', () => {
  // A failed intent may drop `payment_method` and keep the declined card only in its error.
  test('comes from the intent, else from its last payment error, else is unknown', () => {
    expect(
      failedPaymentMethodType({ payment_method: { type: 'sepa_debit' }, last_payment_error: null }),
    ).toBe('sepa_debit');
    expect(
      failedPaymentMethodType({
        payment_method: null,
        last_payment_error: { payment_method: { type: 'card' } },
      }),
    ).toBe('card');
    expect(failedPaymentMethodType({ payment_method: 'pm_test_3', last_payment_error: null })).toBeNull();
    expect(failedPaymentMethodType('pi_test_0001')).toBeNull();
    expect(failedPaymentMethodType(undefined)).toBeNull();
  });
});
