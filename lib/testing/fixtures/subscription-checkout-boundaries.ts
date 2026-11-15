// The real Checkout actions and organization creation (werk-flow/werkflow-planning#248)
// over the in-memory database and a fake Stripe. Only an organization's Admin
// subscribes it: `buero`, `employee`, a foreign organization's id and a
// signed-out caller start no Checkout and create no customer. Before any
// organization exists, a Checkout reserves the organization's id, and only a
// held reservation creates the organization, with that id. A Checkout that
// completed before its signal is re-read, so nobody pays twice.
// The database functions answer as supabase/tests/werkflow_subscriptions.sql proves.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test';
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_test_monthly';
const logged: unknown[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts);
};

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, admin_id: CALLER_ID, name: 'Haustechnik Sonnenberg GmbH' },
    { id: ORGANIZATION_B, admin_id: 'someone-else', name: 'Fremde Firma' },
  ],
  organization_members: [],
  werkflow_subscriptions: [],
});

let gateway: StripeGateway | null = null;
mock.module('@/lib/werkflow-billing/stripe', () => ({
  resolveStripeGateway: () =>
    gateway ? { ok: true, gateway } : { ok: false, code: 'stripe_secret_key_missing' },
}));
const { createFakeStripeBilling, fakeSubscriptionCalls } = await import('./fake-stripe-gateway');
const stripe = createFakeStripeBilling();
gateway = { verifySignal: async () => null, subscriptions: fakeSubscriptionCalls(stripe) };

const subscriptionRows = () => tableRows(world, 'werkflow_subscriptions');
const holds = (status: string | null, reason: string | null = null) =>
  ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(status ?? '') ||
  (status === 'canceled' && reason === 'payment_failed');

// The three database functions, as their SQL test proves them.
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') return { data: true, error: null };
  const rows = subscriptionRows();
  const row = rows.find((entry) => entry.organization_id === args.p_organization_id);
  if (name === 'reserve_werkflow_subscription') {
    if (
      args.p_linked &&
      !tableRows(world, 'organization_members').some(
        (member) =>
          member.organization_id === args.p_organization_id &&
          member.user_id === args.p_user_id &&
          member.role === 'admin',
      )
    ) {
      return { data: null, error: { message: 'not_admin' } };
    }
    if (!row) {
      rows.push({
        organization_id: args.p_organization_id,
        reserved_by: args.p_user_id,
        linked_at: args.p_linked ? '2026-11-15T10:00:00Z' : null,
        stripe_customer_id: args.p_stripe_customer_id,
        stripe_subscription_id: null,
        status: null,
        cancellation_reason: null,
        holds_subscription: false,
      });
    }
    return {
      data:
        subscriptionRows().find((entry) => entry.organization_id === args.p_organization_id)
          ?.stripe_customer_id ?? null,
      error: null,
    };
  }
  if (name === 'record_werkflow_subscription_state') {
    if (!row) return { data: null, error: { message: 'subscription_row_missing' } };
    const reason = typeof args.p_cancellation_reason === 'string' ? args.p_cancellation_reason : null;
    Object.assign(row, {
      stripe_subscription_id: args.p_stripe_subscription_id,
      status: args.p_status,
      cancellation_reason: reason,
      holds_subscription: holds(String(args.p_status), reason),
    });
    return { data: 'recorded', error: null };
  }
  if (name === 'create_organization_from_subscription') {
    const reservation = rows.find(
      (entry) => entry.reserved_by === args.p_admin_id && entry.linked_at === null,
    );
    if (!reservation?.holds_subscription) return { data: null, error: { message: 'subscription_required' } };
    reservation.linked_at = '2026-11-15T10:05:00Z';
    return { data: reservation.organization_id, error: null };
  }
  throw new Error(`unexpected rpc ${name}`);
};
mock.module('@/lib/org/generate-code', () => ({ generateUniqueOrgCode: async () => 'NEWORG' }));
// Organization creation also sets the active-organization cookie.
const cookieWrites: string[] = [];
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'current_org_id' && world.activeOrganizationCookie !== null
        ? { name, value: world.activeOrganizationCookie }
        : undefined,
    set: (name: string, value: string) => cookieWrites.push(`${name}=${value}`),
  }),
  headers: async () => ({ get: () => null }),
}));

const { startOrganizationCheckout, startSubscriptionCheckout } = await import('@/lib/subscription/actions');
const { createOrganization } = await import('@/lib/org/actions');

const businessCalls = () => world.rpcCalls.filter((call) => call.name !== 'consume_rate_limit');
const setMembership = (role: 'admin' | 'buero' | 'employee' | null, orgId = ORGANIZATION_A) => {
  signInAs(world, role, orgId);
  world.tables.organization_members =
    role === null ? [] : [{ organization_id: orgId, user_id: CALLER_ID, role }];
};

// --- An existing organization: only its Admin subscribes it. ---

world.callerId = null;
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'not_authenticated',
});
for (const role of ['buero', 'employee'] as const) {
  setMembership(role);
  assert.deepEqual(
    await startSubscriptionCheckout(ORGANIZATION_A),
    { success: false, error: 'not_authorized' },
    role,
  );
}
setMembership('admin');
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_B), { success: false, error: 'not_a_member' });
assert.deepEqual(await startSubscriptionCheckout('not-an-id'), { success: false, error: 'not_a_member' });
assert.equal(stripe.customers.size, 0, 'a refused caller created a Stripe customer');
assert.deepEqual(businessCalls(), [], 'a refused caller reached the database');

// The Admin gets a Checkout; the customer names the organization in its metadata.
const started = await startSubscriptionCheckout(ORGANIZATION_A);
if (!started.success) throw new Error(JSON.stringify({ started, logged }));
assert.equal(started.checkoutUrl, 'https://checkout.stripe.test/c/pay/cs_test_1');
assert.deepEqual(
  [...stripe.customers.values()],
  [{ organizationId: ORGANIZATION_A, email: 'caller@example.test', name: 'Fixture company' }],
);
assert.deepEqual(stripe.checkoutRequests[0], {
  customerId: 'cus_test_1',
  organizationId: ORGANIZATION_A,
  priceId: 'price_test_monthly',
  successUrl: 'https://app.example.test/dashboard',
  cancelUrl: 'https://app.example.test/upgrade',
});
assert.equal(subscriptionRows()[0]?.linked_at !== null, true);

// A second Checkout reuses the customer; a Checkout that completed before its
// signal is re-read and recorded, and no third Checkout opens.
assert.ok((await startSubscriptionCheckout(ORGANIZATION_A)).success);
assert.equal(stripe.customers.size, 1);
assert.deepEqual(stripe.expiredCheckouts, ['cs_test_1'], 'a second Checkout left the first one payable');
stripe.subscriptions.set('sub_test_1', {
  id: 'sub_test_1',
  customerId: 'cus_test_1',
  organizationId: ORGANIZATION_A,
  status: 'active',
  cancellationReason: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-12-15T10:00:00.000Z',
});
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'already_subscribed',
});
assert.equal(subscriptionRows()[0]?.stripe_subscription_id, 'sub_test_1');
assert.equal(stripe.checkoutRequests.length, 2);

// --- Before any organization: the Checkout reserves the organization's id. ---

setMembership(null);
world.tables.werkflow_subscriptions = [];
assert.deepEqual(await createOrganization('Neue Firma'), { success: false, error: 'subscription_required' });
const reserved = await startOrganizationCheckout();
assert.ok(reserved.success);
const reservation = subscriptionRows()[0];
assert.ok(reservation);
assert.equal(reservation.linked_at, null);
assert.equal(reservation.reserved_by, CALLER_ID);
assert.notEqual(reservation.organization_id, ORGANIZATION_A);
assert.equal(stripe.checkoutRequests.at(-1)?.successUrl, 'https://app.example.test/upgrade/bestaetigt');
assert.equal(stripe.checkoutRequests.at(-1)?.organizationId, reservation.organization_id);
assert.ok((await startOrganizationCheckout()).success);
assert.equal(subscriptionRows().length, 1, 'a second Checkout reserved a second organization');

// An unpaid reservation creates nothing; a paid one creates the organization with the reserved id, once.
assert.deepEqual(await createOrganization('Neue Firma'), { success: false, error: 'subscription_required' });
Object.assign(reservation, { status: 'past_due', holds_subscription: true });
world.tables.werkflow_subscriptions = [reservation];
await assert.rejects(startOrganizationCheckout(), { message: 'redirect:/onboarding/create-organization' });
const created = await createOrganization('Neue Firma');
assert.deepEqual(created, { success: true, organizationId: reservation.organization_id });
assert.deepEqual(cookieWrites, [`current_org_id=${String(reservation.organization_id)}`]);
assert.deepEqual(await createOrganization('Zweite Firma'), {
  success: false,
  error: 'subscription_required',
});

// A caller who belongs to an organization reserves nothing.
setMembership('employee');
assert.deepEqual(await startOrganizationCheckout(), { success: false, error: 'organization_exists' });

// Without a price id or a reachable Stripe the Checkout is unavailable or failed, never half done.
setMembership('admin');
world.tables.werkflow_subscriptions = [];
delete process.env.STRIPE_MONTHLY_PRICE_ID;
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'checkout_unavailable',
});
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_test_monthly';
stripe.down = true;
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'checkout_failed',
});
assert.deepEqual(subscriptionRows(), []);
