// The actual entry actions with only identity, membership and the database
// replaced: a direct edit, a direct delete and a change-request decision never
// change an entry of a closed month and never move an entry into one.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from './in-memory-admin';

const organization = '10000000-0000-4000-8000-000000000001';
const otherOrganization = '10000000-0000-4000-8000-000000000002';
const closedIn = '20000000-0000-4000-8000-000000000001';
const closedOut = '20000000-0000-4000-8000-000000000002';
const openIn = '20000000-0000-4000-8000-000000000003';
const openOut = '20000000-0000-4000-8000-000000000004';
const boundaryIn = '20000000-0000-4000-8000-000000000005';
const closedDelete = '20000000-0000-4000-8000-000000000006';
const movedEdit = '20000000-0000-4000-8000-000000000007';
const openDelete = '20000000-0000-4000-8000-000000000008';
const entry = (id: string, entryType: string, timestamp: string) => ({
  id,
  organization_id: organization,
  user_id: 'employee',
  entry_type: entryType,
  timestamp,
  job_id: null,
  is_manual: true,
  status: 'approved',
  reviewed_by: null,
  reviewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
});
const changeRequest = (
  id: string,
  changeType: string,
  entryId: string,
  pairedEntryId: string | null,
  originalTimestamp: string | null,
) => ({
  id,
  organization_id: organization,
  entry_id: entryId,
  paired_entry_id: pairedEntryId,
  requested_by: 'employee',
  change_type: changeType,
  proposed_timestamp: null,
  original_timestamp: originalTimestamp,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-04-05T08:00:00.000Z',
  updated_at: '2026-04-05T08:00:00.000Z',
});
const tables: InMemoryTables = {
  organization_members: [
    { user_id: 'caller', organization_id: organization, role: 'admin' },
    { user_id: 'employee', organization_id: organization, role: 'employee' },
  ],
  time_entries: [
    entry(closedIn, 'clock_in', '2026-03-10T07:00:00.000Z'),
    entry(closedOut, 'clock_out', '2026-03-10T15:00:00.000Z'),
    entry(openIn, 'clock_in', '2026-04-02T07:00:00.000Z'),
    entry(openOut, 'clock_out', '2026-04-02T15:00:00.000Z'),
    // 22:30 UTC on 31 March is 1 April in Europe/Berlin: an open day.
    entry(boundaryIn, 'clock_in', '2026-03-31T22:30:00.000Z'),
  ],
  entry_change_requests: [
    changeRequest(closedDelete, 'delete', closedIn, closedOut, null),
    // The requested edit already moved this entry out of the closed month; a rejection would move it back.
    changeRequest(movedEdit, 'edit', openIn, null, '2026-03-20T07:00:00.000Z'),
    changeRequest(openDelete, 'delete', openIn, openOut, null),
  ],
  time_periods: [
    {
      id: 'march',
      organization_id: organization,
      state: 'closed',
      period_start_date: '2026-03-01',
      period_end_date: '2026-03-31',
    },
    {
      id: 'april',
      organization_id: organization,
      state: 'prepared',
      period_start_date: '2026-04-01',
      period_end_date: '2026-04-30',
    },
    {
      id: 'foreign-april',
      organization_id: otherOrganization,
      state: 'closed',
      period_start_date: '2026-04-01',
      period_end_date: '2026-04-30',
    },
  ],
};
const timestampOf = (id: string): unknown =>
  (tables.time_entries ?? []).find((row) => row.id === id)?.timestamp;

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organization }) }) }));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => createInMemoryAdmin(tables) }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {},
  getAuthenticatedUser: async () => ({ id: 'caller' }),
  getCachedMemberships: async () => [{ orgId: organization, role: 'admin' }],
  getCachedOrganizationSettings: async () => ({
    breakMode: 'manual',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 30,
  }),
  getCachedOrganizationCalendar: async () => null,
}));
const { updateEntry, deleteEntry, deleteEntriesBatch, reviewChangeRequest } = await import(
  '@/lib/time-tracking/actions'
);
const refused = { success: false, error: 'period_closed' };

// An entry of the closed month keeps its time, also when the new time lies in an open month.
assert.deepEqual(await updateEntry(closedIn, { timestamp: '2026-03-10T07:30:00.000Z' }), refused);
assert.deepEqual(await updateEntry(closedOut, { timestamp: '2026-04-03T15:00:00.000Z' }), refused);
assert.deepEqual(await updateEntry(closedIn, { jobId: null }), refused);
assert.equal(timestampOf(closedIn), '2026-03-10T07:00:00.000Z');
assert.equal(timestampOf(closedOut), '2026-03-10T15:00:00.000Z');

// An entry of an open month never moves into the closed month.
assert.deepEqual(await updateEntry(openIn, { timestamp: '2026-03-20T07:00:00.000Z' }), refused);
assert.equal(timestampOf(openIn), '2026-04-02T07:00:00.000Z');

// The period boundary is the Europe/Berlin date, and a closed period of
// another organization does not lock this one.
assert.equal((await updateEntry(boundaryIn, { timestamp: '2026-03-31T22:45:00.000Z' })).success, true);
assert.equal((await updateEntry(openOut, { timestamp: '2026-04-02T15:30:00.000Z' })).success, true);
assert.equal(timestampOf(openOut), '2026-04-02T15:30:00.000Z');

// A direct delete refuses as soon as one named entry lies in the closed month.
const entryExists = (id: string): boolean => (tables.time_entries ?? []).some((row) => row.id === id);
const requestStatus = (id: string): unknown =>
  (tables.entry_change_requests ?? []).find((row) => row.id === id)?.status;
assert.deepEqual(await deleteEntry(closedIn), refused);
assert.deepEqual(await deleteEntry(openIn, closedOut), refused);
assert.deepEqual(await deleteEntriesBatch([openIn, closedIn]), refused);
assert.deepEqual([closedIn, closedOut, openIn].map(entryExists), [true, true, true]);

// A decision that would delete, restore or move back an entry of the closed
// month leaves the request pending; approving an already applied edit writes nothing.
assert.deepEqual(await reviewChangeRequest(closedDelete, 'approve'), refused);
assert.deepEqual(await reviewChangeRequest(closedDelete, 'reject'), refused);
assert.deepEqual(await reviewChangeRequest(movedEdit, 'reject'), refused);
assert.deepEqual([closedDelete, movedEdit].map(requestStatus), ['pending', 'pending']);
assert.deepEqual([closedIn, closedOut].map(entryExists), [true, true]);
assert.equal(timestampOf(openIn), '2026-04-02T07:00:00.000Z');
assert.equal((await reviewChangeRequest(movedEdit, 'approve')).success, true);

// Open months stay editable.
assert.equal((await reviewChangeRequest(openDelete, 'approve')).success, true);
assert.deepEqual([openIn, openOut].map(entryExists), [false, false]);
assert.equal((await deleteEntriesBatch([boundaryIn])).success, true);
assert.equal(entryExists(boundaryIn), false);
