// A card payer's first invoice (werk-flow/werkflow-planning#245). Stripe
// finalizes and pays it during Checkout, before the payer creates the
// organization, so `invoice.finalized` and `invoice.paid` fail with
// `werkflow_invoice_organization_unknown` and wait in the signal ledger. The
// real organization creation runs the payer's waiting signals after it
// answers, read back from Stripe and handled through the real signal ledger:
// each once, only after the organization exists. A delivery whose attempt
// fails this way while the organization is created meanwhile runs once more,
// though the creation's run read the ledger before its failure. Another
// customer's waiting signal, a settled one, one that failed for another
// reason, one older than the payer's Checkout and one Stripe no longer keeps
// stay as they are. A failure before the organization exists runs nothing
// again, and an unreachable Stripe fails neither the creation nor the run.
// The ledger functions answer as supabase/tests/werkflow_billing_signals.sql proves.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import type Stripe from 'stripe';

import { CALLER_ID, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import type { FakeStripeRequests } from './fake-stripe-gateway';
import { billingFailure } from '@/lib/werkflow-billing/failure';

const NOW = new Date('2026-11-26T19:12:30Z');
setSystemTime(NOW);
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

const RESERVED = '24500000-0000-4000-8000-000000000001';
const CUSTOMER = 'cus_test_card';
const WAITING = 'werkflow_invoice_organization_unknown';
const signal = (id: string, type: string, created: string, more: Record<string, unknown> = {}) => ({
  stripe_event_id: id,
  event_type: type,
  stripe_created_at: created,
  state: 'pending',
  attempts: 1,
  claimed: false,
  last_failure_code: WAITING,
  ...more,
});

const world = installActionWorld({
  organizations: [],
  organization_members: [],
  werkflow_subscriptions: [
    {
      organization_id: RESERVED,
      reserved_by: CALLER_ID,
      linked_at: null,
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: 'sub_test_card',
      holds_subscription: true,
      runs_subscription: true,
      checkout_session_id: 'cs_test_card',
      created_at: secondsAgo(300),
    },
  ],
  werkflow_billing_signals: [
    signal('evt_test_card_finalized', 'invoice.finalized', secondsAgo(62)),
    signal('evt_test_other_customer', 'invoice.finalized', secondsAgo(90)),
    signal('evt_test_card_other_code', 'invoice.finalized', secondsAgo(61), {
      last_failure_code: 'werkflow_invoice_payment_pending',
    }),
    signal('evt_test_card_settled', 'invoice.finalized', secondsAgo(120), {
      state: 'handled',
      last_failure_code: WAITING,
    }),
    signal('evt_test_before_checkout', 'invoice.finalized', secondsAgo(3600)),
    signal('evt_test_card_expired', 'invoice.finalized', secondsAgo(31 * 24 * 3600)),
  ],
});
signInAs(world, null);
const signalRow = (id: string) =>
  tableRows(world, 'werkflow_billing_signals').find((row) => row.stripe_event_id === id);
const organizationExists = () => tableRows(world, 'organizations').some((row) => row.id === RESERVED);

// The ledger functions and the organization's creation from its paid reservation.
world.rpc = ({ name, args }) => {
  const row = signalRow(String(args.p_stripe_event_id));
  if (name === 'create_organization_from_subscription') {
    const reservation = tableRows(world, 'werkflow_subscriptions').find(
      (entry) => entry.reserved_by === args.p_admin_id && entry.linked_at === null,
    );
    if (!reservation?.holds_subscription) return { data: null, error: { message: 'subscription_required' } };
    reservation.linked_at = NOW.toISOString();
    tableRows(world, 'organizations').push({ id: reservation.organization_id, admin_id: args.p_admin_id });
    return { data: reservation.organization_id, error: null };
  }
  if (name === 'claim_werkflow_billing_signal') {
    if (!row) {
      tableRows(world, 'werkflow_billing_signals').push({
        ...signal(
          String(args.p_stripe_event_id),
          String(args.p_event_type),
          String(args.p_stripe_created_at),
        ),
        claimed: true,
        last_failure_code: null,
      });
      return { data: [{ result: 'claimed', attempt: 1 }], error: null };
    }
    if (row.state !== 'pending') return { data: [{ result: 'settled', attempt: row.attempts }], error: null };
    if (row.claimed) return { data: [{ result: 'busy', attempt: row.attempts }], error: null };
    row.attempts = Number(row.attempts) + 1;
    row.claimed = true;
    return { data: [{ result: 'claimed', attempt: row.attempts }], error: null };
  }
  if (name === 'settle_werkflow_billing_signal') {
    if (!row || row.state !== 'pending' || !row.claimed || row.attempts !== args.p_attempt) {
      return { data: false, error: null };
    }
    row.claimed = false;
    if (args.p_outcome === 'failed') row.last_failure_code = args.p_failure_code;
    else Object.assign(row, { state: args.p_outcome, last_failure_code: row.last_failure_code });
    return { data: true, error: null };
  }
  throw new Error(`unexpected rpc ${name}`);
};

mock.module('@/lib/org/generate-code', () => ({ generateUniqueOrgCode: async () => 'CARD01' }));
mock.module('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: () => null }),
}));
// Work after the answer runs when the fixture says, as Vercel runs it after the response.
const afterAnswer: Array<() => Promise<unknown>> = [];
mock.module('next/server', () => ({
  after: (task: () => Promise<unknown>) => {
    afterAnswer.push(task);
  },
}));

// Each family fails as the issue step does while the organization is missing, and records what
// it handled otherwise; the issue step itself is proven in issue-invoice.test.ts.
const handled: string[] = [];
// Runs once in the next attempt, after its organization check: what happens meanwhile.
let duringNextAttempt: (() => Promise<void>) | null = null;
const family = (type: string) => ({
  eventTypes: [type],
  handle: async (event: Stripe.Event) => {
    const organizationKnown = organizationExists();
    const meanwhile = duringNextAttempt;
    duringNextAttempt = null;
    await meanwhile?.();
    if (!organizationKnown) throw billingFailure(WAITING);
    handled.push(event.id);
  },
});
mock.module('@/lib/werkflow-billing/signals/invoice-finalized', () => ({
  invoiceFinalizedSignals: family('invoice.finalized'),
}));
mock.module('@/lib/werkflow-billing/signals/invoice-paid', () => ({
  invoicePaidSignals: family('invoice.paid'),
}));

// Stripe's events as its API answers a read by id; it keeps none older than 30 days.
const stripeEvent = (id: string, type: string, customer: string) => ({
  id,
  object: 'event',
  type,
  created: Math.floor(NOW.getTime() / 1000) - 60,
  livemode: false,
  data: { object: { id: `in_${id}`, object: 'invoice', customer } },
});
const storedEvents = {
  'GET /v1/events/evt_test_card_finalized': stripeEvent(
    'evt_test_card_finalized',
    'invoice.finalized',
    CUSTOMER,
  ),
  'GET /v1/events/evt_test_card_paid': stripeEvent('evt_test_card_paid', 'invoice.paid', CUSTOMER),
  'GET /v1/events/evt_test_other_customer': stripeEvent(
    'evt_test_other_customer',
    'invoice.finalized',
    'cus_test_other',
  ),
  'GET /v1/events/evt_test_card_other_code': stripeEvent(
    'evt_test_card_other_code',
    'invoice.finalized',
    CUSTOMER,
  ),
  'GET /v1/events/evt_test_card_settled': stripeEvent('evt_test_card_settled', 'invoice.finalized', CUSTOMER),
  'GET /v1/events/evt_test_before_checkout': stripeEvent(
    'evt_test_before_checkout',
    'invoice.finalized',
    CUSTOMER,
  ),
};
const answers: Record<string, unknown> = { ...storedEvents };
const requests: FakeStripeRequests = [];
const { createFakeStripeGateway } = await import('./fake-stripe-gateway');
const gateway = createFakeStripeGateway('whsec_fixture_only', { answers, requests });
mock.module('@/lib/werkflow-billing/stripe', () => ({ resolveStripeGateway: () => ({ ok: true, gateway }) }));

const { createOrganization } = await import('@/lib/org/actions');
const { runAgainOnceItsOrganizationExists } = await import('@/lib/werkflow-billing/waiting-signals');
const { receiveSignal } = await import('@/lib/werkflow-billing/signals/receive');
/** One delivery as the webhook route makes it. */
const deliver = async (event: Stripe.Event) =>
  runAgainOnceItsOrganizationExists(event, gateway, await receiveSignal(event, gateway));
const ledger = () => tableRows(world, 'werkflow_billing_signals');
const paid = await gateway.readEvent('evt_test_card_paid');
// Unreachable until the fixture says: every read fails.
const reachStripe = (reachable: boolean) => {
  for (const key of Object.keys(storedEvents)) Reflect.deleteProperty(answers, key);
  if (reachable) Object.assign(answers, storedEvents);
};
reachStripe(false);

// Before the organization exists, the payment signal fails and waits; nothing runs it again.
assert.equal(await deliver(paid), 'failed');
assert.deepEqual(handled, []);
assert.deepEqual(signalRow('evt_test_card_paid'), {
  stripe_event_id: 'evt_test_card_paid',
  event_type: 'invoice.paid',
  stripe_created_at: new Date(paid.created * 1000).toISOString(),
  state: 'pending',
  attempts: 1,
  claimed: false,
  last_failure_code: WAITING,
});

// Stripe's next delivery is in flight when the payer creates the organization: the creation
// answers at once and its run handles the waiting signals after the answer.
let runWaiting: (() => Promise<unknown>) | undefined;
duringNextAttempt = async () => {
  assert.deepEqual(await createOrganization('Haustechnik Sonnenberg GmbH'), {
    success: true,
    organizationId: RESERVED,
  });
  assert.equal(afterAnswer.length, 1, 'the creation left the waiting signals for Stripe alone');
  assert.deepEqual(handled, [], 'a waiting signal ran before the creation answered');
  [runWaiting] = afterAnswer;
  assert.ok(runWaiting);

  // An unreachable Stripe fails nothing and leaves every signal for Stripe's next delivery.
  const atCreation = structuredClone(ledger());
  await runWaiting();
  assert.deepEqual(handled, []);
  assert.deepEqual(ledger(), atCreation, 'an unreachable Stripe changed the ledger');

  // Once Stripe answers, the waiting finalized signal runs once and settles; the payment
  // signal's own attempt still holds its claim.
  reachStripe(true);
  requests.length = 0;
  await runWaiting();
  assert.deepEqual(handled, ['evt_test_card_finalized']);
  assert.equal(signalRow('evt_test_card_finalized')?.state, 'handled');
  assert.equal(signalRow('evt_test_card_finalized')?.attempts, 2, 'the finalized signal ran more than once');
  // Only the signals waiting since the payer's Checkout are read back, and only the payer's run.
  assert.deepEqual(requests.map((request) => request.path).toSorted(), [
    '/v1/events/evt_test_card_finalized',
    '/v1/events/evt_test_card_paid',
    '/v1/events/evt_test_other_customer',
  ]);
};
const untouched = structuredClone(ledger());
// The in-flight attempt fails for want of its organization, then runs once more because it exists now.
assert.equal(await deliver(paid), 'settled');
assert.equal(duringNextAttempt, null, 'the organization was never created');
assert.deepEqual(handled, ['evt_test_card_finalized', 'evt_test_card_paid']);
assert.equal(signalRow('evt_test_card_paid')?.state, 'handled', 'the payment signal stayed open');
assert.equal(signalRow('evt_test_card_paid')?.attempts, 3);
for (const id of [
  'evt_test_other_customer',
  'evt_test_card_other_code',
  'evt_test_card_settled',
  'evt_test_before_checkout',
  'evt_test_card_expired',
]) {
  assert.deepEqual(
    signalRow(id),
    untouched.find((row) => row.stripe_event_id === id),
    `${id} changed though it waits for no new organization`,
  );
}

// A second run handles nothing again.
assert.ok(runWaiting);
await runWaiting();
assert.deepEqual(handled, ['evt_test_card_finalized', 'evt_test_card_paid'], 'a settled signal ran twice');
