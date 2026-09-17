import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
let authenticated = true;
let permitted = false;
const writes: unknown[][] = [];
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ set: (...args: unknown[]) => { writes.push(args); } }) }));
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {}, getAuthenticatedUser: async () => authenticated ? { id: 'caller' } : null,
  getCachedMemberships: async () => permitted ? [{ orgId: organizationId }] : [],
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => { throw new Error('Cookie action must not bypass membership'); } }));
mock.module('@/lib/subscription/helpers', () => ({ isUserSubscribed: async () => false }));
mock.module('@/lib/time-tracking/settings', () => ({ buildBreakPolicyHistoryEntry: () => { throw new Error('Unrelated settings work'); } }));
const { setActiveOrgCookie } = await import('@/lib/org/actions');
authenticated = false;
await assert.rejects(setActiveOrgCookie(organizationId), /not_authenticated/);
authenticated = true;
await assert.rejects(setActiveOrgCookie(organizationId), /not_a_member/);
assert.equal(writes.length, 0);
permitted = true;
await setActiveOrgCookie(organizationId);
assert.deepEqual(writes, [['current_org_id', organizationId, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30, path: '/' }]]);
await assert.rejects(setActiveOrgCookie('10000000-0000-4000-8000-000000000002'), /not_a_member/);
permitted = false;
await assert.rejects(setActiveOrgCookie(organizationId), /not_a_member/);
assert.equal(writes.length, 1, 'Denied or revoked membership must never produce a successful cookie write.');
