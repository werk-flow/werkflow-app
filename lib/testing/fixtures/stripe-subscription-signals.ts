// The checkout and subscription signal handlers (werk-flow/werkflow-planning#248)
// over a fake Stripe and a stand-in for record_werkflow_subscription_state.
// Each handler records Stripe's current state from a re-read, never the event
// body; it maps the subscription to the organization only through the
// customer's metadata; a Checkout of another mode records nothing; a second
// subscription that lands while the first holds is refunded and cancelled at
// once, unless a fresh read shows the first has ended; a subscription the
// database marked for that cancellation never becomes the organization's
// one, even when the first ends before the cancellation runs; and every failure
// throws a stable code, so Stripe delivers the event again.
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
/** The organization's row as record_werkflow_subscription_state keeps it (read times aside). */
const row: { stripe_subscription_id: string | null; holds_subscription: boolean } = {
  stripe_subscription_id: null,
  holds_subscription: false,
};
/** The row's duplicate_subscription_ids: marked under the lock, never accepted. */
const duplicates = new Set<string>();
const holds = (args: RecordCall) =>
  ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(String(args.p_status)) ||
  (args.p_status === 'canceled' && args.p_cancellation_reason === 'payment_failed');

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: RecordCall) => {
      assert.equal(name, 'record_werkflow_subscription_state');
      if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
      if (
        row.stripe_subscription_id !== null &&
        row.stripe_subscription_id !== args.p_stripe_subscription_id
      ) {
        if (!holds(args)) return { data: 'ignored', error: null };
        const subscriptionId = String(args.p_stripe_subscription_id);
        if (duplicates.has(subscriptionId)) return { data: 'duplicate', error: null };
        if (row.holds_subscription) {
          if (args.p_refuse_as_duplicate !== true)
            return { data: null, error: { code: 'P0001', message: 'subscription_conflict' } };
          duplicates.add(subscriptionId);
          return { data: 'duplicate', error: null };
        }
      }
      recorded.push(args);
      Object.assign(row, {
        stripe_subscription_id: args.p_stripe_subscription_id,
        holds_subscription: holds(args),
      });
      return { data: 'recorded', error: null };
    },
    // readOrganizationSubscription's read of the row.
    from: (table: string) => {
      assert.equal(table, 'werkflow_subscriptions');
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: {
            organization_id: ORGANIZATION,
            stripe_customer_id: 'cus_test_1',
            ...row,
          },
          error: null,
        }),
      };
      return query;
    },
  }),
}));

const { createFakeStripeBilling, createFakeStripeGateway } = await import('./fake-stripe-gateway');
const { checkoutSignals } = await import('@/lib/werkflow-billing/signals/checkout');
const { subscriptionSignals } = await import('@/lib/werkflow-billing/signals/subscription');

const secret = `whsec_${randomBytes(24).toString('hex')}`;
const stripe = createFakeStripeBilling();
const gateway = createFakeStripeGateway(secret, { billing: stripe });

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
  p_read_at: '2026-11-15T10:00:01.000Z',
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

// A second subscription of the organization while the first holds: both are
// re-read, the newcomer is refunded and cancelled at once, the first stays,
// and the stable code reaches the signal ledger. Stripe's next delivery finds
// the newcomer cancelled and settles.
recorded.length = 0;
stripe.subscriptions.set('sub_test_2', { ...snapshot, id: 'sub_test_2', status: 'active' });
const duplicate = await signal('customer.subscription.created', { id: 'sub_test_2', object: 'subscription' });
await assert.rejects(subscriptionSignals.handle(duplicate, gateway), {
  code: 'duplicate_subscription_cancelled',
});
assert.deepEqual(stripe.cancelledDuplicates, ['sub_test_2']);
assert.equal(row.stripe_subscription_id, 'sub_test_1', 'the newcomer replaced the holding subscription');
await subscriptionSignals.handle(duplicate, gateway);
assert.deepEqual(stripe.cancelledDuplicates, ['sub_test_2'], 'a redelivery cancelled twice');
assert.equal(row.stripe_subscription_id, 'sub_test_1');

// The stored subscription only looked holding: a fresh read shows it ended,
// so the newcomer replaces it and nothing is cancelled.
stripe.subscriptions.set('sub_test_1', {
  ...snapshot,
  status: 'canceled',
  cancellationReason: 'cancellation_requested',
});
stripe.subscriptions.set('sub_test_3', { ...snapshot, id: 'sub_test_3', status: 'active' });
await checkoutSignals
  .handle(
    await signal('checkout.session.completed', { id: 'cs_test_3', object: 'checkout.session' }),
    gateway,
  )
  .catch(() => assert.fail('cs_test_3 has no subscription yet'));
stripe.checkoutSessions.set('cs_test_3', 'sub_test_3');
stripe.checkoutSessions.set('cs_test_3', 'sub_test_3');
await checkoutSignals.handle(
  await signal('checkout.session.completed', { id: 'cs_test_3', object: 'checkout.session' }),
  gateway,
);
assert.equal(row.stripe_subscription_id, 'sub_test_3', 'a replacement of an ended subscription was refused');
assert.deepEqual(stripe.cancelledDuplicates, ['sub_test_2'], 'a legitimate replacement was cancelled');

// The backstop refused sub_test_5 while sub_test_3 held. Before it cancels
// sub_test_5, sub_test_3 ends and a second delivery of sub_test_5 re-reads
// both: sub_test_5 must not become the organization's subscription, because
// the first delivery's cancellation follows.
Object.assign(row, { stripe_subscription_id: 'sub_test_3', holds_subscription: true });
stripe.subscriptions.set('sub_test_3', { ...snapshot, id: 'sub_test_3', status: 'active' });
stripe.subscriptions.set('sub_test_5', { ...snapshot, id: 'sub_test_5', status: 'active' });
const raced = await signal('customer.subscription.created', { id: 'sub_test_5', object: 'subscription' });
const cancelDuplicate = gateway.subscriptions.cancelDuplicateSubscription;
let concurrent: Promise<unknown> = Promise.resolve();
gateway.subscriptions.cancelDuplicateSubscription = async (subscriptionId) => {
  gateway.subscriptions.cancelDuplicateSubscription = cancelDuplicate;
  stripe.subscriptions.set('sub_test_3', {
    ...snapshot,
    id: 'sub_test_3',
    status: 'canceled',
    cancellationReason: 'cancellation_requested',
  });
  concurrent = subscriptionSignals.handle(raced, gateway).catch((error: unknown) => error);
  await concurrent;
  return cancelDuplicate(subscriptionId);
};
await assert.rejects(subscriptionSignals.handle(raced, gateway), {
  code: 'duplicate_subscription_cancelled',
});
await concurrent;
assert.notEqual(
  row.stripe_subscription_id,
  'sub_test_5',
  'a subscription marked for cancellation was accepted',
);
assert.equal(stripe.subscriptions.get('sub_test_5')?.status, 'canceled');
stripe.subscriptions.set('sub_test_1', snapshot);
Object.assign(row, { stripe_subscription_id: 'sub_test_1', holds_subscription: true });
recorded.length = 0;

// A customer without WerkFlow's metadata, a database refusal and an unreachable Stripe throw a stable code.
const updated = await signal('customer.subscription.updated', { id: 'sub_test_1', object: 'subscription' });
stripe.subscriptions.set('sub_test_1', { ...snapshot, organizationId: null });
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'organization_metadata_missing' });
stripe.subscriptions.set('sub_test_1', snapshot);
for (const code of ['subscription_row_missing', 'subscription_customer_mismatch']) {
  refusal = code;
  await assert.rejects(subscriptionSignals.handle(updated, gateway), { code });
}
refusal = 'connection lost';
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'subscription_record_failed' });
refusal = null;
stripe.down = true;
await assert.rejects(subscriptionSignals.handle(updated, gateway), { code: 'stripe_call_failed' });
assert.deepEqual(recorded, []);
