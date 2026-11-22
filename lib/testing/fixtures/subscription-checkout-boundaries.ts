// The real Checkout actions and organization creation (werk-flow/werkflow-planning#248)
// over the in-memory database and a fake Stripe. Only an organization's Admin
// subscribes it: `buero`, `employee`, a foreign organization's id and a
// signed-out caller start no Checkout and create no customer. Before any
// organization exists, a Checkout reserves the organization's id, and only a
// held reservation creates the organization, with that id. An organization
// has one payable Checkout: every start answers it while it stays open,
// parallel starts create one, a replacement first leaves the stored one
// unpayable, a Checkout paid before its signal is recorded, a failed attempt
// never blocks the next, and a session whose claim lapsed never reaches a payer.
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
// The Checkout flow makes none of the billing reads; any call fails the test.
const noRead = async (): Promise<never> => {
  throw new Error('the Checkout flow made a billing read');
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

const subscriptionRows = () => tableRows(world, 'werkflow_subscriptions');
const holds = (status: string | null, reason: string | null = null) =>
  ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(status ?? '') ||
  (status === 'canceled' && reason === 'payment_failed');

const MINUTE = 60_000;
const later = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();
const before = (time: unknown, minutes = 0) =>
  typeof time === 'string' && Date.parse(time) > Date.now() + minutes * MINUTE;

/** begin_werkflow_checkout, as its SQL test proves it. */
function beginCheckout(args: Record<string, unknown>) {
  const rows = subscriptionRows();
  const row = rows.find((entry) => entry.organization_id === args.p_organization_id);
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
  if (
    !row &&
    !(
      !args.p_linked && rows.some((entry) => entry.reserved_by === args.p_user_id && entry.linked_at === null)
    )
  ) {
    rows.push({
      organization_id: args.p_organization_id,
      reserved_by: args.p_user_id,
      linked_at: args.p_linked ? '2026-11-15T10:00:00Z' : null,
      stripe_customer_id: args.p_stripe_customer_id,
      stripe_subscription_id: null,
      status: null,
      cancellation_reason: null,
      holds_subscription: false,
      checkout_session_id: null,
      checkout_url: null,
      checkout_expires_at: null,
      checkout_attempt: 0,
      checkout_claimed_until: null,
    });
  }
  const held = subscriptionRows().find(
    (entry) =>
      entry.organization_id === args.p_organization_id &&
      (entry.linked_at !== null) === args.p_linked &&
      (args.p_linked || entry.reserved_by === args.p_user_id),
  );
  if (!held) return { data: null, error: { message: 'reservation_refused' } };
  const answer = (result: string, session: Record<string, unknown> = {}) => ({
    data: { result, stripe_customer_id: held.stripe_customer_id, attempt: held.checkout_attempt, ...session },
    error: null,
  });
  if (held.holds_subscription) return answer('subscribed');
  if (before(held.checkout_expires_at, 15) && held.checkout_session_id !== args.p_closed_session_id) {
    return answer('open', { session_id: held.checkout_session_id, session_url: held.checkout_url });
  }
  if (before(held.checkout_claimed_until)) return answer('busy');
  held.checkout_attempt = Number(held.checkout_attempt) + 1;
  held.checkout_claimed_until = later(2);
  return answer('claimed', { session_id: held.checkout_session_id, session_url: null });
}

// The database functions, as their SQL test proves them.
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') return { data: true, error: null };
  const rows = subscriptionRows();
  const row = rows.find((entry) => entry.organization_id === args.p_organization_id);
  if (name === 'begin_werkflow_checkout') return beginCheckout(args);
  if (name === 'finish_werkflow_checkout') {
    if (!row || row.checkout_attempt !== args.p_attempt || !before(row.checkout_claimed_until)) {
      return { data: false, error: null };
    }
    if (typeof args.p_session_id === 'string') {
      Object.assign(row, {
        checkout_session_id: args.p_session_id,
        checkout_url: args.p_session_url,
        checkout_expires_at: args.p_expires_at,
      });
    }
    row.checkout_claimed_until = null;
    return { data: true, error: null };
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
  attempt: 1,
});
const organizationRow = () => {
  const row = subscriptionRows().find((entry) => entry.organization_id === ORGANIZATION_A);
  assert.ok(row);
  return row;
};
assert.notEqual(organizationRow().linked_at, null);
assert.equal(organizationRow().checkout_session_id, 'cs_test_1');

// While it stays open, every start answers the same Checkout and creates none.
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), started);
assert.equal(stripe.checkoutRequests.length, 1, 'a second start opened a second Checkout');

// Near its expiry, the next start first leaves it unpayable, then opens one more.
organizationRow().checkout_expires_at = later(10);
const replaced = await startSubscriptionCheckout(ORGANIZATION_A);
assert.deepEqual(replaced, { success: true, checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_2' });
assert.deepEqual(stripe.expiredCheckouts, ['cs_test_1'], 'a replacement left the earlier Checkout payable');
assert.equal(stripe.customers.size, 1);

// A failed attempt, which Stripe keeps for its idempotency key, never blocks the next one.
organizationRow().checkout_expires_at = later(10);
stripe.failNextCheckout = true;
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'checkout_failed',
});
assert.equal(organizationRow().checkout_claimed_until, null, 'a failed attempt kept its claim');
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: true,
  checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_3',
});
assert.deepEqual(
  stripe.checkoutRequests.map((request) => request.attempt),
  [1, 2, 4],
  "a new attempt reused a failed attempt's idempotency key",
);

// Two parallel starts create one Checkout: the second one waits for the first.
organizationRow().checkout_expires_at = later(10);
const parallel = await Promise.all([
  startSubscriptionCheckout(ORGANIZATION_A),
  startSubscriptionCheckout(ORGANIZATION_A),
]);
assert.deepEqual(parallel, [
  { success: true, checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_4' },
  { success: false, error: 'checkout_in_progress' },
]);
assert.equal(stripe.checkoutRequests.length, 4, 'two parallel starts opened two Checkouts');

// A start whose claim lapsed while Stripe answered hands its session to nobody;
// the start that claimed after it hands out its own.
organizationRow().checkout_expires_at = later(10);
let overtaking: Awaited<ReturnType<typeof startSubscriptionCheckout>> | null = null;
stripe.beforeNextCall = async () => {
  stripe.beforeNextCall = async () => {
    organizationRow().checkout_claimed_until = later(-1);
    overtaking = await startSubscriptionCheckout(ORGANIZATION_A);
  };
};
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'checkout_failed',
});
assert.deepEqual(overtaking, { success: true, checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_5' });
assert.equal(organizationRow().checkout_url, 'https://checkout.stripe.test/c/pay/cs_test_5');

// The Admin paid the stored Checkout before its signal, with most of its time
// left: the next start reads it at Stripe, records the subscription, and
// neither hands out the paid Checkout nor opens another.
const paidSubscription = (id: string, status: string, cancellationReason: string | null = null) =>
  stripe.subscriptions.set(id, {
    id,
    customerId: 'cus_test_1',
    organizationId: ORGANIZATION_A,
    status,
    cancellationReason,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-12-15T10:00:00.000Z',
  });
const forgetSubscription = () =>
  Object.assign(organizationRow(), {
    stripe_subscription_id: null,
    status: null,
    cancellation_reason: null,
    holds_subscription: false,
  });
stripe.checkoutSessions.set('cs_test_5', 'sub_test_1');
paidSubscription('sub_test_1', 'active');
assert.ok(
  before(organizationRow().checkout_expires_at, 60),
  'the paid Checkout has more than 15 minutes left',
);
let requestsBefore = stripe.checkoutRequests.length;
assert.deepEqual(
  await startSubscriptionCheckout(ORGANIZATION_A),
  { success: false, error: 'already_subscribed' },
  'a start handed out a Checkout already paid',
);
assert.equal(organizationRow().stripe_subscription_id, 'sub_test_1');
assert.equal(stripe.checkoutRequests.length, requestsBefore, 'a paid Checkout was followed by another');
assert.equal(stripe.expiredCheckouts.includes('cs_test_5'), false, 'a paid Checkout was expired');

// The subscription that Checkout started no longer holds: the paid Checkout
// is still not handed out, and the start opens the next one.
paidSubscription('sub_test_1', 'canceled', 'cancellation_requested');
forgetSubscription();
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: true,
  checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_7',
});
assert.equal(organizationRow().status, 'canceled');
assert.equal(organizationRow().checkout_session_id, 'cs_test_7');

// Near its expiry, a stored Checkout paid before its signal is recorded the
// same way while the start claims the next attempt; nothing more opens.
stripe.checkoutSessions.set('cs_test_7', 'sub_test_2');
paidSubscription('sub_test_2', 'active');
organizationRow().checkout_expires_at = later(10);
requestsBefore = stripe.checkoutRequests.length;
assert.deepEqual(await startSubscriptionCheckout(ORGANIZATION_A), {
  success: false,
  error: 'already_subscribed',
});
assert.equal(organizationRow().stripe_subscription_id, 'sub_test_2');
assert.equal(stripe.checkoutRequests.length, requestsBefore, 'a paid Checkout was followed by another');
assert.equal(stripe.expiredCheckouts.includes('cs_test_7'), false, 'a paid Checkout was expired');
assert.equal(organizationRow().checkout_claimed_until, null);

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
// A failed customer create blocks nothing: the next start creates the customer and the Checkout.
stripe.down = false;
assert.equal((await startSubscriptionCheckout(ORGANIZATION_A)).success, true);
