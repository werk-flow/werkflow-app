// A card payer's first invoice (werk-flow/werkflow-planning#245). Stripe
// finalizes and pays it during Checkout, before the payer creates the
// organization, so `invoice.finalized` and `invoice.paid` fail with
// `werkflow_invoice_organization_unknown` and wait in the signal ledger. The
// real organization creation runs them again after it answers, read back from
// Stripe and handled through the real signal ledger: each once, only after
// the organization exists. Another customer's waiting signal, a settled one,
// one that failed for another reason and one Stripe no longer keeps stay as
// they are. An unreachable Stripe fails neither the creation nor the run, and
// leaves the signals for Stripe's next delivery.
// The ledger functions answer as supabase/tests/werkflow_billing_signals.sql proves.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import type Stripe from 'stripe';

import { CALLER_ID, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import type { FakeStripeRequests } from './fake-stripe-gateway';

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
    },
  ],
  werkflow_billing_signals: [
    // Listed newest first, so the run's order is its own.
    signal('evt_test_card_paid', 'invoice.paid', secondsAgo(60)),
    signal('evt_test_card_finalized', 'invoice.finalized', secondsAgo(62)),
    signal('evt_test_other_customer', 'invoice.finalized', secondsAgo(90)),
    signal('evt_test_card_other_code', 'invoice.finalized', secondsAgo(61), {
      last_failure_code: 'werkflow_invoice_payment_pending',
    }),
    signal('evt_test_card_settled', 'invoice.finalized', secondsAgo(120), {
      state: 'handled',
      last_failure_code: WAITING,
    }),
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
    assert.ok(row, 'a run claimed a signal the ledger never recorded');
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

// Each family records what it handled; its issue step is proven in issue-invoice.test.ts.
const handled: string[] = [];
const family = (type: string) => ({
  eventTypes: [type],
  handle: async (event: Stripe.Event) => {
    assert.ok(organizationExists(), `${event.id} ran before its organization existed`);
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
};
// Empty while Stripe is unreachable: every read fails.
const answers: Record<string, unknown> = {};
const requests: FakeStripeRequests = [];
const { createFakeStripeGateway } = await import('./fake-stripe-gateway');
const gateway = createFakeStripeGateway('whsec_fixture_only', { answers, requests });
mock.module('@/lib/werkflow-billing/stripe', () => ({ resolveStripeGateway: () => ({ ok: true, gateway }) }));

const { createOrganization } = await import('@/lib/org/actions');
const untouched = structuredClone(tableRows(world, 'werkflow_billing_signals'));

// The organization is created at once; its waiting signals run after the answer.
assert.deepEqual(await createOrganization('Haustechnik Sonnenberg GmbH'), {
  success: true,
  organizationId: RESERVED,
});
assert.equal(afterAnswer.length, 1, 'the creation left the waiting signals for Stripe alone');
assert.deepEqual(handled, [], 'a waiting signal ran before the creation answered');
const [runWaiting] = afterAnswer;
assert.ok(runWaiting);

// An unreachable Stripe fails nothing and leaves every signal waiting for Stripe's next delivery.
await runWaiting();
assert.deepEqual(handled, []);
assert.deepEqual(
  tableRows(world, 'werkflow_billing_signals'),
  untouched,
  'an unreachable Stripe changed the ledger',
);

// Once Stripe answers, the payer's invoice signals run once each, oldest first, and settle.
Object.assign(answers, storedEvents);
requests.length = 0;
await runWaiting();
assert.deepEqual(handled, ['evt_test_card_finalized', 'evt_test_card_paid']);
for (const id of ['evt_test_card_finalized', 'evt_test_card_paid']) {
  assert.equal(signalRow(id)?.state, 'handled', `${id} stayed open after it ran`);
  assert.equal(signalRow(id)?.attempts, 2, `${id} ran more than once`);
}
// Only the signals waiting for an organization are read back, and only the payer's run.
assert.deepEqual(requests.map((request) => request.path).toSorted(), [
  '/v1/events/evt_test_card_finalized',
  '/v1/events/evt_test_card_paid',
  '/v1/events/evt_test_other_customer',
]);
for (const id of [
  'evt_test_other_customer',
  'evt_test_card_other_code',
  'evt_test_card_settled',
  'evt_test_card_expired',
]) {
  assert.deepEqual(
    signalRow(id),
    untouched.find((row) => row.stripe_event_id === id),
    `${id} changed though it waits for no new organization`,
  );
}

// A second run handles nothing again.
await runWaiting();
assert.deepEqual(handled, ['evt_test_card_finalized', 'evt_test_card_paid'], 'a settled signal ran twice');
