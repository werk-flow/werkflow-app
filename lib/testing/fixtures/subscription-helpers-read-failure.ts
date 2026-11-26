// The real subscription helpers with the database clients replaced: a failed
// read rejects and is never reported as "not subscribed" or "no
// organizations"; a missing subscription row stays a plain "none".
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

type ReadResult = { data?: unknown; count?: number | null; error: { code: string; message: string } | null };
let nextResult: ReadResult = { data: null, error: null };
/** Answers for the next reads in order, before nextResult. */
const queued: ReadResult[] = [];
const answer = (): ReadResult => queued.shift() ?? nextResult;

function builder(): object {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: () => Promise.resolve(answer()),
    then: (resolve: (value: ReadResult) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: () => builder() }),
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: () => builder() }) }));

const { memberLeavesOnboarding, readOpenReservation, readOrganizationSubscription, userHasOrganizations } =
  await import('@/lib/subscription/helpers');
const userId = '30000000-0000-4000-8000-000000000001';
const organizationId = '20000000-0000-4000-8000-00000000000a';
const failure = {
  code: '57014',
  message: 'canceling statement due to statement timeout, user x@example.test',
};

nextResult = {
  data: {
    organization_id: organizationId,
    stripe_customer_id: 'cus_test_1',
    stripe_subscription_id: 'sub_test_1',
    holds_subscription: true,
    runs_subscription: false,
    checkout_session_id: 'cs_test_1',
  },
  error: null,
};
assert.deepEqual(await readOpenReservation(userId), {
  organizationId,
  stripeCustomerId: 'cus_test_1',
  stripeSubscriptionId: 'sub_test_1',
  holdsSubscription: true,
  runsSubscription: false,
  checkoutSessionId: 'cs_test_1',
});
nextResult = { data: null, error: null };
assert.equal(await readOpenReservation(userId), null, 'a missing row is no reservation');
assert.equal(await readOrganizationSubscription(organizationId), null, 'a missing row is no subscription');
nextResult = { data: null, error: failure };
await assert.rejects(readOpenReservation(userId), { name: 'SubscriptionReadError' });
await assert.rejects(readOrganizationSubscription(organizationId), { name: 'SubscriptionReadError' });

nextResult = { count: 2, error: null };
assert.equal(await userHasOrganizations(userId), true);
nextResult = { count: 0, error: null };
assert.equal(await userHasOrganizations(userId), false);
nextResult = { count: null, error: failure };
await assert.rejects(userHasOrganizations(userId), { name: 'SubscriptionReadError' });

// Onboarding sends a member to the dashboard, except while they name the further
// organization their paid reservation holds (werk-flow/werkflow-planning#495).
const heldReservation = {
  organization_id: organizationId,
  stripe_customer_id: 'cus_test_2',
  stripe_subscription_id: 'sub_test_2',
  holds_subscription: true,
  runs_subscription: true,
  checkout_session_id: null,
};
queued.push({ count: 1, error: null }, { data: heldReservation, error: null });
assert.equal(await memberLeavesOnboarding(userId), false, 'a paid further organization could not be named');
queued.push(
  { count: 1, error: null },
  { data: { ...heldReservation, holds_subscription: false }, error: null },
);
assert.equal(await memberLeavesOnboarding(userId), true, 'an unpaid reservation kept a member in onboarding');
queued.push({ count: 1, error: null }, { data: null, error: null });
assert.equal(await memberLeavesOnboarding(userId), true);
queued.push({ count: 0, error: null });
assert.equal(await memberLeavesOnboarding(userId), false, 'a newcomer was sent away from onboarding');
queued.push({ count: 1, error: null }, { data: null, error: failure });
await assert.rejects(memberLeavesOnboarding(userId), { name: 'SubscriptionReadError' });
