// The checkout and subscription signal handlers (werk-flow/werkflow-planning#248)
// over a fake Stripe and a stand-in for record_werkflow_subscription_state.
// Each handler records Stripe's current state from a re-read, never the event
// body; it maps the subscription to the organization only through the
// customer's metadata; a Checkout of another mode records nothing; a second
// subscription that lands while the first runs is refunded and cancelled at
// once and raises the alarm, unless a fresh read shows the first has ended; a
// subscription the database marked for that cancellation never becomes the
// organization's one, even when the first ends before the cancellation runs;
// a cleanup cut short resumes on the next delivery, also once the duplicate
// was cancelled outside WerkFlow; one Stripe ended after a failed first debit
// gives way to its restart (werk-flow/werkflow-planning#495); a refund Stripe
// reports failed raises its alarm and is recorded against its duplicate; and
// every failure throws a stable code, so Stripe delivers the event again.
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
const row: {
  stripe_subscription_id: string | null;
  holds_subscription: boolean;
  runs_subscription: boolean;
} = { stripe_subscription_id: null, holds_subscription: false, runs_subscription: false };
/** The row's duplicate_subscription_ids: marked under the lock, never accepted. */
const duplicates = new Set<string>();
/** The row's settled_duplicate_subscription_ids: refunded, cancelled and alarmed. */
const settled = new Set<string>();
const refundFailures: RecordCall[] = [];
const runs = (args: RecordCall) =>
  ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(String(args.p_status));
const holds = (args: RecordCall) =>
  runs(args) || (args.p_status === 'canceled' && args.p_cancellation_reason === 'payment_failed');
const alarms: Array<{ kind: string; stripeObjectId: string }> = [];
let alarmDown = false;

mock.module('server-only', () => ({}));
// The dispatch table also loads the families that send customer mails; none runs here.
// The invoice mails after an issue have their own cases (billing-invoice-mails.ts).
mock.module('@/lib/werkflow-billing/invoice-mails', () => ({
  sendDebitNotice: async () => {},
  sendInvoiceMail: async () => {},
  sendReceiptMail: async () => {},
}));
mock.module('@/lib/werkflow-billing/mail-delivery', () => ({
  deliverCustomerBillingMail: async () => assert.fail('a customer mail was sent'),
  describeCustomerMail: () => assert.fail('a customer mail was described'),
  raiseBillingAlarm: async (alarm: { kind: string; stripeObjectId: string }) => {
    if (alarmDown) throw Object.assign(new Error('alarm'), { code: 'billing_mail_claim_failed' });
    if (!alarms.some((sent) => sent.kind === alarm.kind && sent.stripeObjectId === alarm.stripeObjectId)) {
      alarms.push({ kind: alarm.kind, stripeObjectId: alarm.stripeObjectId });
    }
  },
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: RecordCall) => {
      if (name === 'settle_werkflow_duplicate_subscription') {
        settled.add(String(args.p_stripe_subscription_id));
        return { data: null, error: null };
      }
      if (name === 'record_werkflow_refund_failure') {
        refundFailures.push(args);
        return { data: true, error: null };
      }
      assert.equal(name, 'record_werkflow_subscription_state');
      if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
      const subscriptionId = String(args.p_stripe_subscription_id);
      if (duplicates.has(subscriptionId)) {
        return { data: settled.has(subscriptionId) ? 'ignored' : 'duplicate', error: null };
      }
      if (
        row.stripe_subscription_id !== null &&
        row.stripe_subscription_id !== args.p_stripe_subscription_id
      ) {
        if (!runs(args)) return { data: 'ignored', error: null };
        if (row.runs_subscription) {
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
        runs_subscription: runs(args),
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
const { refundSignals } = await import('@/lib/werkflow-billing/signals/refund');
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch');

const secret = `whsec_${randomBytes(24).toString('hex')}`;
const stripe = createFakeStripeBilling();
const gateway = createFakeStripeGateway(secret, {
  billing: stripe,
  objects: {
    customers: { cus_test_1: { id: 'cus_test_1', organizationId: ORGANIZATION, email: null, name: null } },
  },
});

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

// A second subscription of the organization while the first runs: both are
// re-read, the newcomer is refunded and cancelled at once, the first stays,
// and the alarm reaches a person. A failed alarm leaves the cleanup open, so
// the next delivery raises it; once settled, a redelivery changes nothing.
recorded.length = 0;
stripe.subscriptions.set('sub_test_2', { ...snapshot, id: 'sub_test_2', status: 'active' });
const duplicate = await signal('customer.subscription.created', { id: 'sub_test_2', object: 'subscription' });
alarmDown = true;
await assert.rejects(subscriptionSignals.handle(duplicate, gateway), { code: 'billing_mail_claim_failed' });
alarmDown = false;
assert.deepEqual(stripe.cancelledDuplicates, ['sub_test_2']);
assert.equal(settled.has('sub_test_2'), false, 'a cleanup without its alarm was settled');
await subscriptionSignals.handle(duplicate, gateway);
assert.deepEqual(alarms, [{ kind: 'duplicate_subscription_cancelled', stripeObjectId: 'sub_test_2' }]);
assert.ok(settled.has('sub_test_2'), 'the cleanup was not settled');
assert.equal(row.stripe_subscription_id, 'sub_test_1', 'the newcomer replaced the running subscription');
const cleanups = stripe.cancelledDuplicates.length;
await subscriptionSignals.handle(duplicate, gateway);
assert.equal(stripe.cancelledDuplicates.length, cleanups, 'a settled duplicate was cleaned up again');
assert.equal(row.stripe_subscription_id, 'sub_test_1');

// The refund of a duplicate's payment fails before the cleanup cancelled it,
// and a person cancels it in Stripe's dashboard: that signal resumes the
// cleanup, so the refund is issued after all.
stripe.subscriptions.set('sub_test_4', { ...snapshot, id: 'sub_test_4', status: 'active' });
const cancelDuplicateOnce = gateway.subscriptions.cancelDuplicateSubscription;
gateway.subscriptions.cancelDuplicateSubscription = async () => {
  gateway.subscriptions.cancelDuplicateSubscription = cancelDuplicateOnce;
  throw Object.assign(new Error('stripe_call_failed'), { code: 'stripe_call_failed' });
};
await assert.rejects(
  subscriptionSignals.handle(
    await signal('customer.subscription.created', { id: 'sub_test_4', object: 'subscription' }),
    gateway,
  ),
  { code: 'stripe_call_failed' },
);
stripe.subscriptions.set('sub_test_4', {
  ...snapshot,
  id: 'sub_test_4',
  status: 'canceled',
  cancellationReason: 'cancellation_requested',
});
await subscriptionSignals.handle(
  await signal('customer.subscription.deleted', { id: 'sub_test_4', object: 'subscription' }),
  gateway,
);
assert.equal(stripe.cancelledDuplicates.at(-1), 'sub_test_4', 'a cleanup cancelled outside WerkFlow stopped');
assert.ok(settled.has('sub_test_4'));

// The stored subscription only looked holding: a fresh read shows it ended,
// so the newcomer replaces it and nothing is cancelled.
stripe.subscriptions.set('sub_test_1', {
  ...snapshot,
  status: 'canceled',
  cancellationReason: 'cancellation_requested',
});
stripe.subscriptions.set('sub_test_3', { ...snapshot, id: 'sub_test_3', status: 'active' });
const cleanupsBeforeReplacement = stripe.cancelledDuplicates.length;
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
assert.equal(
  stripe.cancelledDuplicates.length,
  cleanupsBeforeReplacement,
  'a legitimate replacement was cancelled',
);

// The backstop refused sub_test_5 while sub_test_3 held. Before it cancels
// sub_test_5, sub_test_3 ends and a second delivery of sub_test_5 re-reads
// both: sub_test_5 must not become the organization's subscription, because
// the first delivery's cancellation follows.
Object.assign(row, { stripe_subscription_id: 'sub_test_3', holds_subscription: true });
stripe.subscriptions.set('sub_test_3', { ...snapshot, id: 'sub_test_3', status: 'active' });
stripe.subscriptions.set('sub_test_5', { ...snapshot, id: 'sub_test_5', status: 'active' });
Object.assign(row, { runs_subscription: true });
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
await subscriptionSignals.handle(raced, gateway);
await concurrent;
assert.notEqual(
  row.stripe_subscription_id,
  'sub_test_5',
  'a subscription marked for cancellation was accepted',
);
assert.equal(stripe.subscriptions.get('sub_test_5')?.status, 'canceled');
// Stripe ended the stored subscription after its first debit failed: it still
// holds, but the Admin's restart replaces it and is not cancelled.
Object.assign(row, {
  stripe_subscription_id: 'sub_test_3',
  holds_subscription: true,
  runs_subscription: false,
});
stripe.subscriptions.set('sub_test_6', { ...snapshot, id: 'sub_test_6', status: 'active' });
const cleanupsBefore = stripe.cancelledDuplicates.length;
await subscriptionSignals.handle(
  await signal('customer.subscription.created', { id: 'sub_test_6', object: 'subscription' }),
  gateway,
);
assert.equal(row.stripe_subscription_id, 'sub_test_6', 'a restart after a failed first debit was refused');
assert.equal(stripe.cancelledDuplicates.length, cleanupsBefore, 'a restart was cancelled as a duplicate');

// A refund of a duplicate that Stripe reports failed is recorded against the
// duplicate and its payment, and raises the alarm; on a redelivery the alarm
// ledger sends it once. Any other refund state changes nothing; a failed
// refund outside the backstop only raises the alarm.
const refund = {
  id: 're_test_1',
  status: 'failed',
  amountCents: 4900,
  paymentIntentId: 'pi_test_1',
  customerId: 'cus_test_1',
  duplicateSubscriptionId: 'sub_test_2',
};
stripe.refunds.set('re_test_1', refund);
stripe.refunds.set('re_test_2', { ...refund, id: 're_test_2', status: 'succeeded' });
stripe.refunds.set('re_test_3', { ...refund, id: 're_test_3', duplicateSubscriptionId: null });
// Pending when the cleanup settled, cancelled afterwards: it paid nothing either.
stripe.refunds.set('re_test_4', { ...refund, id: 're_test_4', status: 'canceled' });
assert.equal(signalFamilyFor('refund.failed'), refundSignals);
assert.equal(signalFamilyFor('charge.refund.updated'), refundSignals);
alarms.length = 0;
const failedRefund = await signal('refund.failed', {
  id: 're_test_1',
  object: 'refund',
  status: 'succeeded',
});
await refundSignals.handle(failedRefund, gateway);
await refundSignals.handle(failedRefund, gateway);
await refundSignals.handle(
  await signal('charge.refund.updated', { id: 're_test_2', object: 'refund', status: 'failed' }),
  gateway,
);
await refundSignals.handle(
  await signal('charge.refund.updated', { id: 're_test_3', object: 'refund' }),
  gateway,
);
await refundSignals.handle(
  await signal('charge.refund.updated', { id: 're_test_4', object: 'refund' }),
  gateway,
);
assert.deepEqual(refundFailures[0], {
  p_organization_id: ORGANIZATION,
  p_stripe_subscription_id: 'sub_test_2',
  p_stripe_refund_id: 're_test_1',
  p_stripe_payment_intent_id: 'pi_test_1',
});
assert.equal(
  refundFailures.length,
  3,
  'the database was not asked again on a redelivery, or for another refund',
);
assert.equal(
  refundFailures[2]?.p_stripe_refund_id,
  're_test_4',
  'a refund cancelled after the cleanup was not recorded',
);
assert.deepEqual(alarms, [
  { kind: 'refund_failed', stripeObjectId: 're_test_1' },
  { kind: 'refund_failed', stripeObjectId: 're_test_3' },
  { kind: 'refund_failed', stripeObjectId: 're_test_4' },
]);

stripe.subscriptions.set('sub_test_1', snapshot);
Object.assign(row, {
  stripe_subscription_id: 'sub_test_1',
  holds_subscription: true,
  runs_subscription: true,
});
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
