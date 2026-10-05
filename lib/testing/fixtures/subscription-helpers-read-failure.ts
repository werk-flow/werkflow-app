// The real subscription helpers with the caller's database client replaced: a
// failed read rejects and is never reported as "not subscribed" or "no
// organizations"; a missing subscription row stays a plain "not subscribed".
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

type ReadResult = { data?: unknown; count?: number | null; error: { code: string; message: string } | null };
let nextResult: ReadResult = { data: null, error: null };

function builder(): object {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(nextResult),
    then: (resolve: (value: ReadResult) => unknown) => Promise.resolve(nextResult).then(resolve),
  };
  return chain;
}

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: () => builder() }),
}));

const { isUserSubscribed, userHasOrganizations } = await import('@/lib/subscription/helpers');
const userId = '30000000-0000-4000-8000-000000000001';
const failure = {
  code: '57014',
  message: 'canceling statement due to statement timeout, user x@example.test',
};

nextResult = { data: { status: 'active' }, error: null };
assert.equal(await isUserSubscribed(userId), true);
nextResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
assert.equal(await isUserSubscribed(userId), false, 'a missing row is not subscribed');
nextResult = { data: null, error: failure };
await assert.rejects(isUserSubscribed(userId), { name: 'SubscriptionReadError' });

nextResult = { count: 2, error: null };
assert.equal(await userHasOrganizations(userId), true);
nextResult = { count: 0, error: null };
assert.equal(await userHasOrganizations(userId), false);
nextResult = { count: null, error: failure };
await assert.rejects(userHasOrganizations(userId), { name: 'SubscriptionReadError' });
