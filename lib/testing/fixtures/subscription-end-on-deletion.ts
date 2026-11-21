// Deleting an organization, or an account with a paid reservation, ends its
// Stripe subscription first (werk-flow/werkflow-planning#495): the open
// Checkout expires and every running subscription of the customer is
// cancelled at once, without a refund, through the gateway once; a rerun
// cancels nothing twice. A Stripe failure refuses the deletion, and nothing
// is deleted. The real actions run over the in-memory database and a fake Stripe.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

console.error = () => {};
const RESERVED = '20000000-0000-4000-8000-0000000000cc';

const world = installActionWorld({
  organizations: [{ id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: CALLER_ID }],
  organization_members: [],
  werkflow_subscriptions: [
    {
      organization_id: ORGANIZATION_A,
      reserved_by: CALLER_ID,
      linked_at: '2026-11-01T10:00:00Z',
      stripe_customer_id: 'cus_test_1',
      stripe_subscription_id: 'sub_test_1',
      holds_subscription: true,
      runs_subscription: true,
      checkout_session_id: 'cs_test_open',
    },
  ],
});

mock.module('@/lib/storage/r2', () => ({ listStorageObjectPaths: async () => [] }));
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'current_org_id' && world.activeOrganizationCookie !== null
        ? { name, value: world.activeOrganizationCookie }
        : undefined,
    set: () => {},
  }),
  headers: async () => ({ get: () => null }),
}));

let gateway: StripeGateway | null = null;
mock.module('@/lib/werkflow-billing/stripe', () => ({
  resolveStripeGateway: () =>
    gateway ? { ok: true, gateway } : { ok: false, code: 'stripe_secret_key_missing' },
}));
const { createFakeStripeBilling, fakeSubscriptionCalls } = await import('./fake-stripe-gateway');
const stripe = createFakeStripeBilling();
const noRead = async (): Promise<never> => {
  throw new Error('The deletion made an unexpected Stripe read.');
};
gateway = {
  verifySignal: async () => null,
  readInvoiceForIssue: noRead,
  readInvoice: noRead,
  readCustomer: noRead,
  readMandate: noRead,
  readDispute: noRead,
  subscriptions: fakeSubscriptionCalls(stripe),
};
const subscription = (id: string, customerId: string, organizationId: string, status: string) =>
  stripe.subscriptions.set(id, {
    id,
    customerId,
    organizationId,
    status,
    cancellationReason: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-12-01T10:00:00.000Z',
  });
subscription('sub_test_1', 'cus_test_1', ORGANIZATION_A, 'past_due');
subscription('sub_test_old', 'cus_test_1', ORGANIZATION_A, 'canceled');
subscription('sub_test_other', 'cus_test_other', '20000000-0000-4000-8000-0000000000dd', 'active');
stripe.checkoutSessions.set('cs_test_open', null);

const recorded: Record<string, unknown>[] = [];
let deleted = false;
world.rpc = ({ name, args }) => {
  if (name === 'get_organization_deletion_scope') {
    return {
      data: {
        members: 1,
        open_invites: 0,
        clients: 0,
        projects: 0,
        jobs: 0,
        employee_records: 1,
        documents: 0,
        retained_documents: 0,
        time_tracked_people: 0,
        closed_periods: 0,
        payroll_exports: 0,
      },
      error: null,
    };
  }
  if (name === 'record_werkflow_subscription_state') {
    recorded.push(args);
    return { data: 'recorded', error: null };
  }
  if (name === 'delete_organization_with_files') {
    deleted = true;
    world.tables.organizations = [];
    return { data: null, error: null };
  }
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { deleteOrganization } = await import('@/lib/org/delete-action');
const { deleteAccount } = await import('@/lib/auth/actions');

// An unreachable Stripe refuses the deletion: nothing is cancelled and nothing deleted.
signInAs(world, 'admin');
stripe.down = true;
assert.deepEqual(await deleteOrganization('Musterbetrieb'), {
  success: false,
  error: 'subscription_end_failed',
});
assert.equal(deleted, false, 'the organization went while its subscription still ran');
stripe.down = false;

// The Checkout expires and the running subscription is cancelled once, without a refund, before the rows go.
let cancelledBeforeDeletion = false;
const end = gateway.subscriptions.endCustomerSubscriptions;
gateway.subscriptions.endCustomerSubscriptions = async (customerId, sessionId) => {
  cancelledBeforeDeletion = !deleted;
  return end(customerId, sessionId);
};
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: true, nextOrgId: null });
assert.ok(cancelledBeforeDeletion, 'the organization went before its subscription was cancelled');
assert.deepEqual(
  stripe.endedSubscriptions,
  ['sub_test_1'],
  'not exactly the running subscription was cancelled',
);
assert.deepEqual(stripe.expiredCheckouts, ['cs_test_open'], 'the open Checkout stayed payable');
assert.deepEqual(stripe.cancelledDuplicates, [], 'the deletion refunded a payment');
assert.equal(
  stripe.subscriptions.get('sub_test_other')?.status,
  'active',
  "another customer's subscription ended",
);
assert.equal(recorded.at(-1)?.p_status, 'canceled', 'the cancellation was not recorded');
assert.equal(recorded.at(-1)?.p_stripe_subscription_id, 'sub_test_1');

// A rerun, as after a refusal in the database, cancels nothing twice.
deleted = false;
world.tables.organizations = [
  { id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: CALLER_ID },
];
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: true, nextOrgId: null });
assert.deepEqual(stripe.endedSubscriptions, ['sub_test_1'], 'a rerun cancelled a subscription twice');

// An account whose owner paid before the organization existed: its reservation's subscription ends first.
signInAs(world, null);
world.callerId = CALLER_ID;
world.tables.organization_members = [];
tableRows(world, 'werkflow_subscriptions').push({
  organization_id: RESERVED,
  reserved_by: CALLER_ID,
  linked_at: null,
  stripe_customer_id: 'cus_test_reserved',
  stripe_subscription_id: 'sub_test_reserved',
  holds_subscription: true,
  runs_subscription: true,
  checkout_session_id: null,
});
subscription('sub_test_reserved', 'cus_test_reserved', RESERVED, 'active');
let accountDeleted = false;
world.deleteUser = () => {
  accountDeleted = true;
  return { error: null };
};
stripe.down = true;
assert.deepEqual(await deleteAccount(), { success: false, error: 'subscription_end_failed' });
assert.equal(accountDeleted, false, 'the account went while its subscription still ran');
stripe.down = false;
assert.deepEqual(await deleteAccount(), { success: true });
assert.ok(accountDeleted);
assert.deepEqual(stripe.endedSubscriptions, ['sub_test_1', 'sub_test_reserved']);
