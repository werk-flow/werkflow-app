import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { Json } from '@/lib/supabase/database.types';

// Isolate module mocks from the unit process. Exercise the actual server reader.
mock.module('server-only', () => ({}));
const rows = new Map<string, Json>();
let readCount = 0;
let failRead = false;
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      assert.equal(table, 'organization_user_preferences');
      const filters = new Map<string, string>();
      const query = {
        select(columns: string) {
          assert.equal(columns, 'preferences');
          return query;
        },
        eq(column: string, value: string) {
          filters.set(column, value);
          return query;
        },
        maybeSingle() {
          readCount += 1;
          const organizationId = filters.get('organization_id');
          const userId = filters.get('user_id');
          assert.ok(organizationId && userId, 'Each read must bind both caller identities.');
          const preferences = rows.get(JSON.stringify([organizationId, userId]));
          return Promise.resolve({
            data: preferences === undefined ? null : { preferences },
            error: failRead ? { code: '08006' } : null,
          });
        },
      };
      return query;
    },
  }),
}));

const { getCalendarPreferencesForPage } = await import('@/lib/calendar/preferences-server');
rows.set(JSON.stringify(['org-a', 'user-a']), { calendar: { horizonWeeks: 2, density: 'compact' } });
assert.equal((await getCalendarPreferencesForPage('org-a', 'user-a')).horizonWeeks, 2);
rows.set(JSON.stringify(['org-a', 'user-a']), { calendar: { horizonWeeks: 1, density: 'comfortable' } });
assert.equal((await getCalendarPreferencesForPage('org-a', 'user-a')).horizonWeeks, 1);
assert.equal(readCount, 2, 'Separate calls outside a React render must read the saved value again.');

rows.set(JSON.stringify(['org-b', 'user-a']), { calendar: { horizonWeeks: 6 } });
rows.set(JSON.stringify(['org-a', 'user-b']), { calendar: { horizonWeeks: 4 } });
assert.equal((await getCalendarPreferencesForPage('org-b', 'user-a')).horizonWeeks, 6);
assert.equal((await getCalendarPreferencesForPage('org-a', 'user-b')).horizonWeeks, 4);
assert.equal((await getCalendarPreferencesForPage('org-empty', 'user-a')).horizonWeeks, 1);
failRead = true;
await assert.rejects(() => getCalendarPreferencesForPage('org-a', 'user-a'), /08006/);
failRead = false;
assert.equal((await getCalendarPreferencesForPage('org-a', 'user-a')).horizonWeeks, 1);

// A delayed save retains its original organization even after the active cookie changes.
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: { organizationUserPreferences: () => 'preferences' },
}));
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({ success: true, context: { orgId: 'org-b', userId: 'user-a' } }),
}));
const { saveCalendarPreferences } = await import('@/lib/calendar/preferences-actions');
const readsBefore = readCount;
assert.deepEqual(await saveCalendarPreferences('org-a', { view: 'month' }), {
  success: false,
  error: 'organization_changed',
});
assert.equal(
  readCount,
  readsBefore,
  'A stale scope must not read or overwrite the active organization preferences.',
);
