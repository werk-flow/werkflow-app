// The checkout and subscription signal handlers (werk-flow/werkflow-planning#248)
// over a fake Stripe and a stand-in for record_werkflow_subscription_state.
// Each handler records Stripe's current state from a re-read, never the event
// body; it maps the subscription to the organization only through the
// customer's metadata; a Checkout of another mode records nothing; and every
// failure throws a stable code, so Stripe delivers the event again.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

const NOW = new Date('2026-11-15T10:00:00Z');
setSystemTime(NOW);
console.error = () => {};

const ORGANIZATION = '20000000-0000-4000-8000-00000000000a';
type RecordCall = Record<string, unknown>;
const recorded: RecordCall[] = [];
let refusal: string | null = null;

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: RecordCall) => {
      assert.equal(name, 'record_werkflow_subscription_state');
      if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
      recorded.push(args);
      return { data: 'recorded', error: null };
    },
  }),
}));

const { createFakeStripeBilling, createFakeStripeGateway } = await import('./fake-stripe-gateway');
const { checkoutSignals } = await import('@/lib/werkflow-billing/signals/checkout');
const { subscriptionSignals } = await import('@/lib/werkflow-billing/signals/subscription');

const secret = `whsec_${randomBytes(24).toString('hex')}`;
const stripe = createFakeStripeBilling();
const gateway = createFakeStripeGateway(secret, stripe);

/** A verified event, as the endpoint hands it on; its body claims what the test says. */
async function signal(type: string, object: Record<string, unknown>): Promise<Stripe.Event> {
  const payload = JSON.stringify({
    id: `evt_test_${randomBytes(6).toString('hex')}`,
    object: 'event',
    type,
    created: NOW.getTime() / 1000,
    livemode: false,
    data: { object },
  });
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const event = await gateway.verifySignal(payload, header);
  assert.ok(event);
  return event;
}

const snapshot = {
  id: 'sub_test_1',
  customerId: 'cus_test_1',
  organizationId: ORGANIZATION,
  status: 'past_due',
  cancellationReason: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-12-15T10:00:00.000Z',
};
stripe.subscriptions.set('sub_test_1', snapshot);

// The event body says active; Stripe says past due now: the re-read wins.
await subscriptionSignals.handle(
  await signal('customer.subscription.updated', {
    id: 'sub_test_1',
    object: 'subscription',
    status: 'active',
  }),
  gateway,
);
assert.deepEqual(recorded.pop(), {
  p_organization_id: ORGANIZATION,
  p_stripe_customer_id: 'cus_test_1',
  p_stripe_subscription_id: 'sub_test_1',
  p_status: 'past_due',
  p_cancel_at_period_end: false,
  p_current_period_end: '2026-12-15T10:00:00.000Z',
});

// A cancellation for a failed payment is recorded with its reason; the database keeps it holding.
stripe.subscriptions.set('sub_test_1', {
  ...snapshot,
  status: 'canceled',
  cancellationReason: 'payment_failed',
});
await subscriptionSignals.handle(
  await signal('customer.subscription.deleted', { id: 'sub_test_1', object: 'subscription' }),
  gateway,
);
assert.equal(recorded.pop()?.p_cancellation_reason, 'payment_failed');

// A completed Checkout records the subscription it started; one of another mode records nothing.
stripe.subscriptions.set('sub_test_1', { ...snapshot, status: 'active', cancelAtPeriodEnd: true });
stripe.checkoutSessions.set('cs_test_sub', 'sub_test_1');
stripe.checkoutSessions.set('cs_test_payment', null);
await checkoutSignals.handle(
  await signal('checkout.session.completed', { id: 'cs_test_sub', object: 'checkout.session' }),
  gateway,
);
const fromCheckout = recorded.pop();
assert.equal(fromCheckout?.p_status, 'active');
assert.equal(fromCheckout?.p_cancel_at_period_end, true);
await checkoutSignals.handle(
  await signal('checkout.session.completed', { id: 'cs_test_payment', object: 'checkout.session' }),
  gateway,
);
assert.deepEqual(recorded, [], 'a Checkout without a subscription recorded one');

// A customer without WerkFlow's metadata, a database refusal and an unreachable Stripe throw a stable code.
const updated = await signal('customer.subscription.updated', { id: 'sub_test_1', object: 'subscription' });
stripe.subscriptions.set('sub_test_1', { ...snapshot, organizationId: null });
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'organization_metadata_missing' });
stripe.subscriptions.set('sub_test_1', snapshot);
for (const code of ['subscription_row_missing', 'subscription_customer_mismatch', 'subscription_conflict']) {
  refusal = code;
  await assert.rejects(subscriptionSignals.handle(updated, gateway), { code });
}
refusal = 'connection lost';
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'subscription_record_failed' });
refusal = null;
stripe.down = true;
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'stripe_call_failed' });
assert.deepEqual(recorded, []);
