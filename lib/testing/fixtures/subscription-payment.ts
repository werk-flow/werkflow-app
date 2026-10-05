// Actual subscription helpers and the simulated payment with identity,
// navigation and the database replaced: only an active subscription counts,
// and the payment activates the caller's own subscription exactly when the
// caller has no organization yet.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, tableRows } from './action-boundary-world';

const otherUserId = '30000000-0000-4000-8000-000000000002';
// Keys the rate limiter's subject hash; lib/security/rate-limit.test.ts covers the limits.
process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
const world = installActionWorld({
  subscriptions: [
    { id: 'subscription-other', user_id: otherUserId, status: 'canceled', plan_id: 'dev_plan' },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: otherUserId, role: 'admin' }],
});
const { isUserSubscribed, userHasOrganizations } = await import('@/lib/subscription/helpers');
const { simulatePayment } = await import('@/lib/subscription/actions');

const subscriptionRows = (): Array<Record<string, unknown>> => tableRows(world, 'subscriptions');
const setSubscriptions = (rows: Array<Record<string, unknown>>): void => {
  world.tables.subscriptions = rows;
};

// Only the status `active` is a subscription; a missing row and every other status are not.
assert.equal(await isUserSubscribed(CALLER_ID), false);
for (const [status, expected] of [
  ['active', true],
  ['trialing', false],
  ['inactive', false],
  ['canceled', false],
] as const) {
  setSubscriptions([{ id: 'subscription-caller', user_id: CALLER_ID, status, plan_id: null }]);
  assert.equal(await isUserSubscribed(CALLER_ID), expected, status);
  assert.equal(await isUserSubscribed(otherUserId), false, 'another user never inherits the subscription');
}
setSubscriptions([
  { id: 'subscription-other', user_id: otherUserId, status: 'canceled', plan_id: 'dev_plan' },
]);

// Organization membership is read per user.
assert.equal(await userHasOrganizations(CALLER_ID), false);
assert.equal(await userHasOrganizations(otherUserId), true);

// A signed-out caller activates nothing.
world.callerId = null;
assert.deepEqual(await simulatePayment(), { success: false, error: 'not_authenticated' });
assert.equal(world.adminClientRequests, 0);

// A caller who already belongs to an organization is sent to the dashboard without a subscription write.
world.callerId = otherUserId;
await assert.rejects(simulatePayment(), { message: 'redirect:/dashboard' });
assert.equal(world.adminClientRequests, 0);
assert.deepEqual(
  subscriptionRows().map((row) => row.status),
  ['canceled'],
);

// A new caller gets an active subscription for the own user id and continues to organization creation.
// The in-memory database has no upsert, so the fixture adds the one call the action makes.
world.callerId = CALLER_ID;
const upserts: Array<{ row: Record<string, unknown>; conflictTarget: string }> = [];
let upsertError: { message: string } | null = null;
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string) => {
      assert.equal(name, 'consume_rate_limit');
      return { data: true, error: null };
    },
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, options: { onConflict: string }) => {
        assert.equal(table, 'subscriptions');
        upserts.push({ row, conflictTarget: options.onConflict });
        return { error: upsertError };
      },
    }),
  }),
}));
await assert.rejects(simulatePayment(), { message: 'redirect:/onboarding/create-organization' });
assert.deepEqual(upserts, [
  { row: { user_id: CALLER_ID, status: 'active', plan_id: 'dev_plan' }, conflictTarget: 'user_id' },
]);

// A failed activation is reported and does not continue to onboarding.
upsertError = { message: 'write refused' };
assert.deepEqual(await simulatePayment(), { success: false, error: 'subscription_activation_failed' });
