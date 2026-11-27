// The billing page's real reads and actions (werk-flow/werkflow-planning#252)
// over the in-memory database and a fake Stripe. WerkFlow's invoices and
// subscription are the organization Admin's business only: Büro, an employee,
// a caller from another organization and a signed-out caller read nothing,
// change nothing and reach neither Stripe nor storage. Another
// organization's invoice id answers like an unknown one. A cancellation ends
// the subscription at the end of the paid period and can be taken back until
// then; the page offers only what the actions accept. The database functions
// answer as supabase/tests/werkflow_subscriptions.sql and werkflow_invoices.sql prove.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

console.error = () => {};
// The paid period ends after this instant, so taking a cancellation back stays possible on any run date.
setSystemTime(new Date('2026-11-20T08:00:00Z'));

const INVOICE_A_OLD = '40000000-0000-4000-8000-0000000000a1';
const INVOICE_A_NEW = '40000000-0000-4000-8000-0000000000a2';
const INVOICE_B = '40000000-0000-4000-8000-0000000000b1';
const PERIOD_END = '2026-12-15T10:00:00.000Z';

const invoice = (id: string, organizationId: string, number: string, issueDate: string) => ({
  id,
  organization_id: organizationId,
  number,
  issue_date: issueDate,
  type_code: '380',
  line_names: ['WerkFlow Monatsabo'],
  service_start: issueDate,
  service_end: '2026-12-14',
  gross_cents: 49900,
  due_cents: 0,
  file_key: `werkflow-billing/invoices/in_test_${number}/${'a'.repeat(64)}.pdf`,
});

const subscriptionRow = (organizationId: string, subscriptionId: string | null, status: string | null) => ({
  organization_id: organizationId,
  stripe_customer_id: `cus_test_${organizationId.slice(-1)}`,
  stripe_subscription_id: subscriptionId,
  status,
  cancellation_reason: null,
  cancel_at_period_end: false,
  current_period_end: subscriptionId ? PERIOD_END : null,
});

const world = installActionWorld({
  organization_members: [],
  werkflow_subscriptions: [
    subscriptionRow(ORGANIZATION_A, 'sub_test_a', 'active'),
    subscriptionRow(ORGANIZATION_B, 'sub_test_b', 'active'),
  ],
  werkflow_invoices: [
    invoice(INVOICE_A_NEW, ORGANIZATION_A, 'MUSTER-0002', '2026-11-15'),
    invoice(INVOICE_B, ORGANIZATION_B, 'MUSTER-0003', '2026-11-15'),
    invoice(INVOICE_A_OLD, ORGANIZATION_A, 'MUSTER-0001', '2026-10-15'),
  ],
});

// record_werkflow_subscription_state, as its SQL test proves it, for the fields the page reads.
let recordFails = false;
world.rpc = ({ name, args }) => {
  if (name !== 'record_werkflow_subscription_state') throw new Error(`unexpected rpc ${name}`);
  if (recordFails) return { data: null, error: { message: 'connection failure' } };
  const row = tableRows(world, 'werkflow_subscriptions').find(
    (entry) => entry.organization_id === args.p_organization_id,
  );
  if (!row) return { data: null, error: { message: 'subscription_row_missing' } };
  if (row.stripe_customer_id !== args.p_stripe_customer_id) {
    return { data: null, error: { message: 'subscription_customer_mismatch' } };
  }
  Object.assign(row, {
    stripe_subscription_id: args.p_stripe_subscription_id,
    status: args.p_status,
    cancel_at_period_end: args.p_cancel_at_period_end,
    current_period_end: args.p_current_period_end ?? null,
  });
  return { data: 'recorded', error: null };
};

const signed: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createWerkflowBillingDownloadUrl: async ({ path }: { path: string }) => {
    signed.push(path);
    return `https://r2.example.test/${path}?signed`;
  },
}));

let gateway: StripeGateway | null = null;
mock.module('@/lib/werkflow-billing/stripe', () => ({
  resolveStripeGateway: () =>
    gateway ? { ok: true, gateway } : { ok: false, code: 'stripe_secret_key_missing' },
}));
const { createFakeStripeBilling, fakeSubscriptionCalls } = await import('./fake-stripe-gateway');
const stripe = createFakeStripeBilling();
for (const [subscriptionId, organizationId, customerId] of [
  ['sub_test_a', ORGANIZATION_A, 'cus_test_a'],
  ['sub_test_b', ORGANIZATION_B, 'cus_test_b'],
] as const) {
  stripe.subscriptions.set(subscriptionId, {
    id: subscriptionId,
    customerId,
    organizationId,
    status: 'active',
    cancellationReason: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
  });
  stripe.renewalAmounts.set(subscriptionId, 49900);
}
stripe.paymentMethods.set('sub_test_a', { kind: 'sepa_debit', lastFour: '3000' });

// Every Stripe call the page makes, by method.
const stripeCalls: string[] = [];
let afterNextChange: (() => Promise<unknown>) | null = null;
const calls = fakeSubscriptionCalls(stripe);
const noRead = async (): Promise<never> => {
  throw new Error('The billing page made an unexpected Stripe read.');
};
gateway = {
  verifySignal: async () => null,
  readInvoiceForIssue: noRead,
  readRefundForStorno: noRead,
  readInvoice: noRead,
  readCustomer: noRead,
  readMandate: noRead,
  readDispute: noRead,
  readUpcomingDebit: noRead,
  readInvoiceDebit: noRead,
  listFinalizedInvoices: noRead,
  listEventIds: noRead,
  readEvent: noRead,
  subscriptions: {
    ...calls,
    readSubscription: (id) => {
      stripeCalls.push(`readSubscription ${id}`);
      return calls.readSubscription(id);
    },
    readBillingOutlook: (id) => {
      stripeCalls.push(`readBillingOutlook ${id}`);
      return calls.readBillingOutlook(id);
    },
    setCancelAtPeriodEnd: async (id, cancel) => {
      stripeCalls.push(`setCancelAtPeriodEnd ${id} ${String(cancel)}`);
      await calls.setCancelAtPeriodEnd(id, cancel);
      // What another session does after Stripe applied this change and before its answer lands.
      const meanwhile = afterNextChange;
      afterNextChange = null;
      await meanwhile?.();
    },
  },
};

const { readWerkflowBilling, readWerkflowBillingOutlook } = await import(
  '@/lib/werkflow-billing/billing-page'
);
const { cancelWerkflowSubscription, resumeWerkflowSubscription, openWerkflowInvoice } = await import(
  '@/lib/werkflow-billing/billing-actions'
);

const rowOf = (organizationId: string) =>
  tableRows(world, 'werkflow_subscriptions').find((row) => row.organization_id === organizationId);

/** Every read and action the page has, for the organization asked about. */
const everyEntry = (organizationId: string) => ({
  readWerkflowBilling: () => readWerkflowBilling(organizationId),
  readWerkflowBillingOutlook: () => readWerkflowBillingOutlook(organizationId),
  cancelWerkflowSubscription: () => cancelWerkflowSubscription(organizationId),
  resumeWerkflowSubscription: () => resumeWerkflowSubscription(organizationId),
  openWerkflowInvoice: () => openWerkflowInvoice(organizationId, INVOICE_A_NEW),
});

async function assertRefusedEverywhere(organizationId: string, error: string, who: string) {
  for (const [entry, run] of Object.entries(everyEntry(organizationId))) {
    assert.deepEqual(await run(), { success: false, error }, `${who}: ${entry}`);
  }
  assert.deepEqual(stripeCalls, [], `${who} reached Stripe`);
  assert.deepEqual(world.rpcCalls, [], `${who} wrote the subscription`);
  assert.deepEqual(signed, [], `${who} signed a download`);
  assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false, `${who} changed the subscription`);
}

// --- Nobody but the organization's Admin reads or changes anything. ---

world.callerId = null;
await assertRefusedEverywhere(ORGANIZATION_A, 'not_authenticated', 'a signed-out caller');
for (const role of ['buero', 'employee'] as const) {
  signInAs(world, role, ORGANIZATION_A);
  await assertRefusedEverywhere(ORGANIZATION_A, 'not_authorized', role);
}
// The Admin of another organization names this one: not a member, whatever the cookie says.
signInAs(world, 'admin', ORGANIZATION_B);
world.activeOrganizationCookie = ORGANIZATION_A;
await assertRefusedEverywhere(ORGANIZATION_A, 'not_a_member', 'a foreign Admin');
signInAs(world, 'admin', ORGANIZATION_A);
assert.deepEqual(await cancelWerkflowSubscription('not-an-id'), { success: false, error: 'invalid_input' });
assert.deepEqual(await openWerkflowInvoice(ORGANIZATION_A, 'not-an-id'), {
  success: false,
  error: 'invalid_input',
});

// --- The Admin reads the organization's invoices and subscription. ---

const billing = await readWerkflowBilling(ORGANIZATION_A);
assert.ok(billing.success);
assert.deepEqual(
  billing.billing.invoices.map((entry) => entry.number),
  ['MUSTER-0002', 'MUSTER-0001'],
  "the Admin reads exactly the organization's invoices",
);
assert.deepEqual(billing.billing.invoices[0], {
  id: INVOICE_A_NEW,
  number: 'MUSTER-0002',
  issueDate: '2026-11-15',
  isStorno: false,
  lineNames: ['WerkFlow Monatsabo'],
  servicePeriod: { start: '2026-11-15', end: '2026-12-14' },
  grossCents: 49900,
  dueCents: 0,
});
assert.deepEqual(billing.billing.subscription, {
  state: { kind: 'active', renewsAt: PERIOD_END },
  canCancel: true,
  canResume: false,
  canSubscribe: false,
});
assert.deepEqual(await readWerkflowBillingOutlook(ORGANIZATION_A), {
  success: true,
  outlook: {
    upcoming: { amountCents: 49900, dueAt: PERIOD_END },
    paymentMethod: { kind: 'sepa_debit', lastFour: '3000' },
  },
});

// Another organization's invoice answers like an unknown one; the Admin's own opens.
assert.deepEqual(await openWerkflowInvoice(ORGANIZATION_A, INVOICE_B), {
  success: false,
  error: 'invoice_not_found',
});
assert.deepEqual(signed, []);
assert.deepEqual(await openWerkflowInvoice(ORGANIZATION_A, INVOICE_A_NEW), {
  success: true,
  url: `https://r2.example.test/werkflow-billing/invoices/in_test_MUSTER-0002/${'a'.repeat(64)}.pdf?signed`,
});

// --- Cancelling ends the subscription at the end of the paid period, and can be taken back. ---

stripeCalls.length = 0;
assert.deepEqual(await resumeWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'subscription_not_resumable',
});
assert.deepEqual(
  stripeCalls,
  ['readSubscription sub_test_a'],
  'a running subscription has no cancellation to take back',
);

stripeCalls.length = 0;
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), { success: true, shown: true });
// The change is recorded from a read after it, never from the change's own answer.
assert.deepEqual(stripeCalls, [
  'readSubscription sub_test_a',
  'setCancelAtPeriodEnd sub_test_a true',
  'readSubscription sub_test_a',
]);
assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, true);
assert.equal(stripe.subscriptions.get('sub_test_a')?.status, 'active', 'access runs until the period ends');
const ending = await readWerkflowBilling(ORGANIZATION_A);
assert.ok(ending.success);
assert.deepEqual(ending.billing.subscription, {
  state: { kind: 'ending', endsAt: PERIOD_END },
  canCancel: false,
  canResume: true,
  canSubscribe: false,
});
assert.deepEqual(await readWerkflowBillingOutlook(ORGANIZATION_A), {
  success: true,
  outlook: { upcoming: null, paymentMethod: { kind: 'sepa_debit', lastFour: '3000' } },
});
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'subscription_not_cancellable',
});

assert.deepEqual(await resumeWerkflowSubscription(ORGANIZATION_A), { success: true, shown: true });
assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, false);
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false);
// The other organization's subscription never moved.
assert.equal(stripe.subscriptions.get('sub_test_b')?.cancelAtPeriodEnd, false);
assert.equal(rowOf(ORGANIZATION_B)?.cancel_at_period_end, false);

// --- Two Admins at once: the later answer never overwrites the newer change. ---

// Another Admin takes the cancellation back after Stripe applied it and before this answer lands.
afterNextChange = () => resumeWerkflowSubscription(ORGANIZATION_A);
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), { success: true, shown: true });
assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, false);
assert.equal(
  rowOf(ORGANIZATION_A)?.cancel_at_period_end,
  false,
  'the record follows Stripe, not the later answer',
);

// --- A change Stripe holds but WerkFlow failed to record is said so, and the next step judges Stripe. ---

// Stripe applies the change, then becomes unreachable for the read after it: still a success, shown later.
for (const [change, cancelled] of [
  [cancelWerkflowSubscription, true],
  [resumeWerkflowSubscription, false],
] as const) {
  afterNextChange = async () => {
    stripe.down = true;
  };
  assert.deepEqual(await change(ORGANIZATION_A), { success: true, shown: false });
  stripe.down = false;
  assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, cancelled);
}
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false);

recordFails = true;
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), { success: true, shown: false });
assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, true);
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false, 'the record lags behind Stripe');
// The stale record still says running; taking the cancellation back works on Stripe's state.
assert.deepEqual(await resumeWerkflowSubscription(ORGANIZATION_A), { success: true, shown: false });
assert.equal(stripe.subscriptions.get('sub_test_a')?.cancelAtPeriodEnd, false);
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), { success: true, shown: false });
recordFails = false;
// A refused second cancel brings the record up to Stripe, so the reloaded page offers the right step.
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'subscription_not_cancellable',
});
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, true);
assert.deepEqual(await resumeWerkflowSubscription(ORGANIZATION_A), { success: true, shown: true });
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false);

// --- An unreachable Stripe fails the outlook and the change, never the invoices. ---

stripe.down = true;
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'stripe_unavailable',
});
assert.equal(rowOf(ORGANIZATION_A)?.cancel_at_period_end, false);
assert.deepEqual(await readWerkflowBillingOutlook(ORGANIZATION_A), {
  success: false,
  error: 'stripe_unavailable',
});
assert.equal((await readWerkflowBilling(ORGANIZATION_A)).success, true);
stripe.down = false;

// A failed record read is a failure, never "no subscription".
world.failingTables.add('werkflow_subscriptions');
assert.deepEqual(await readWerkflowBilling(ORGANIZATION_A), { success: false, error: 'load_failed' });
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), { success: false, error: 'load_failed' });
world.failingTables.delete('werkflow_subscriptions');

// --- An ended subscription offers no change; a pilot organization has none. ---

Object.assign(rowOf(ORGANIZATION_A) ?? {}, { status: 'canceled', cancel_at_period_end: true });
const stripeSubscription = stripe.subscriptions.get('sub_test_a');
if (stripeSubscription) {
  stripe.subscriptions.set('sub_test_a', {
    ...stripeSubscription,
    status: 'canceled',
    cancelAtPeriodEnd: true,
  });
}
const ended = await readWerkflowBilling(ORGANIZATION_A);
assert.ok(ended.success);
assert.deepEqual(ended.billing.subscription, {
  state: { kind: 'ended', endedAt: PERIOD_END },
  canCancel: false,
  canResume: false,
  canSubscribe: true,
});
stripeCalls.length = 0;
assert.deepEqual(await resumeWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'subscription_not_resumable',
});
assert.deepEqual(stripeCalls, ['readSubscription sub_test_a'], 'an ended subscription is never changed');

stripeCalls.length = 0;
world.tables.werkflow_subscriptions = tableRows(world, 'werkflow_subscriptions').filter(
  (row) => row.organization_id !== ORGANIZATION_A,
);
const pilot = await readWerkflowBilling(ORGANIZATION_A);
assert.ok(pilot.success);
assert.equal(pilot.billing.subscription, null);
assert.deepEqual(await readWerkflowBillingOutlook(ORGANIZATION_A), { success: true, outlook: null });
assert.deepEqual(await cancelWerkflowSubscription(ORGANIZATION_A), {
  success: false,
  error: 'subscription_not_cancellable',
});
assert.deepEqual(stripeCalls, []);
assert.equal(world.callerId, CALLER_ID);
