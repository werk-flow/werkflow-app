import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'employee' }> = [];
let protectedReads = 0;
const forbiddenRead = (): never => { protectedReads++; throw new Error('denied caller reached a protected read'); };
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: forbiddenRead }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {}, getAuthenticatedUser: async () => authenticated ? { id: 'caller' } : null,
  getCachedMemberships: async () => memberships, getCachedOrganizationSettings: forbiddenRead, getCachedOrganizationCalendar: forbiddenRead,
}));
const { getCanonicalClockState } = await import('@/lib/time-tracking/segment-actions');
const { getCurrentClockState } = await import('@/lib/time-tracking/actions');
for (const read of [getCanonicalClockState, getCurrentClockState]) {
  authenticated = false;
  assert.deepEqual(await read(organizationId), { success: false, error: 'not_authenticated' });
  authenticated = true; memberships = [];
  assert.deepEqual(await read(organizationId), { success: false, error: 'not_a_member' });
  memberships = [{ orgId: '10000000-0000-4000-8000-000000000002', role: 'employee' }];
  assert.deepEqual(await read(organizationId), { success: false, error: 'not_a_member' });
  assert.equal(protectedReads, 0, 'neither a direct call nor the canonical early-return path may read retained time data or settings without membership');
}
