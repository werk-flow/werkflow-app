import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
let authenticated = true;
let permitted = false;
const writes: unknown[][] = [];
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({
  cookies: async () => ({
    set: (...args: unknown[]) => {
      writes.push(args);
    },
  }),
}));
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {},
  getAuthenticatedUser: async () => (authenticated ? { id: 'caller' } : null),
  getCachedMemberships: async () => (permitted ? [{ orgId: organizationId }] : []),
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => {
    throw new Error('Cookie action must not bypass membership');
  },
}));
mock.module('@/lib/subscription/helpers', () => ({ isUserSubscribed: async () => false }));
const { setActiveOrgCookie } = await import('@/lib/org/actions');
const refused = (error: string) => ({ success: false, error });
authenticated = false;
assert.deepEqual(await setActiveOrgCookie(organizationId), refused('not_authenticated'));
authenticated = true;
assert.deepEqual(await setActiveOrgCookie(organizationId), refused('not_a_member'));
assert.equal(writes.length, 0);
permitted = true;
assert.deepEqual(await setActiveOrgCookie(organizationId), { success: true });
assert.deepEqual(writes, [
  [
    'current_org_id',
    organizationId,
    { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30, path: '/' },
  ],
]);
assert.deepEqual(await setActiveOrgCookie('10000000-0000-4000-8000-000000000002'), refused('not_a_member'));
permitted = false;
assert.deepEqual(await setActiveOrgCookie(organizationId), refused('not_a_member'));
assert.equal(writes.length, 1, 'Denied or revoked membership must never produce a successful cookie write.');
