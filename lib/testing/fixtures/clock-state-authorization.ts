import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'employee' }> = [];
let protectedReads = 0;
const forbiddenRead = (): never => {
  protectedReads++;
  throw new Error('denied caller reached a protected read');
};
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: forbiddenRead }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {},
  getAuthenticatedUser: async () => (authenticated ? { id: 'caller' } : null),
  getCachedMemberships: async () => memberships,
  getCachedOrganizationSettings: forbiddenRead,
  getCachedOrganizationCalendar: forbiddenRead,
}));
const { getCurrentClockState } = await import('@/lib/time-tracking/clock-state-actions');
authenticated = false;
assert.deepEqual(await getCurrentClockState(organizationId), { success: false, error: 'not_authenticated' });
authenticated = true;
memberships = [];
assert.deepEqual(await getCurrentClockState(organizationId), { success: false, error: 'not_a_member' });
memberships = [{ orgId: '10000000-0000-4000-8000-000000000002', role: 'employee' }];
assert.deepEqual(await getCurrentClockState(organizationId), { success: false, error: 'not_a_member' });
assert.equal(
  protectedReads,
  0,
  'the clock state may read no retained time data or settings without membership',
);
