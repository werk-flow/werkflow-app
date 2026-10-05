// Actual legacy time-entry actions with only identity, membership,
// responsibility and the database replaced: a caller-supplied id never reaches
// a row of another organization or person.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from './in-memory-admin';

const ownOrganization = '10000000-0000-4000-8000-000000000001';
const foreignOrganization = '10000000-0000-4000-8000-000000000002';
const ownJob = '30000000-0000-4000-8000-000000000001';
const foreignJob = '30000000-0000-4000-8000-000000000002';
const ownIn = '20000000-0000-4000-8000-000000000001';
const ownOut = '20000000-0000-4000-8000-000000000002';
const colleagueIn = '20000000-0000-4000-8000-000000000003';
const foreignIn = '20000000-0000-4000-8000-000000000004';
const callerIn = '20000000-0000-4000-8000-000000000005';
const ownPending = '20000000-0000-4000-8000-000000000006';
const foreignPending = '20000000-0000-4000-8000-000000000007';
const ownEditRequest = '50000000-0000-4000-8000-000000000001';
const foreignDeleteRequest = '50000000-0000-4000-8000-000000000002';
const callerUser = '40000000-0000-4000-8000-000000000001';
const employeeUser = '40000000-0000-4000-8000-000000000002';
const colleagueUser = '40000000-0000-4000-8000-000000000003';
const strangerUser = '40000000-0000-4000-8000-000000000004';
const today = new Date(Date.now() - 1000).toISOString();
const yesterday = (hour: number): string => {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
const entry = (
  id: string,
  organizationId: string,
  userId: string,
  entryType: string,
  timestamp: string,
  jobId: string | null = null,
) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
  entry_type: entryType,
  timestamp,
  job_id: jobId,
  is_manual: true,
  status: 'approved',
  reviewed_by: null,
  reviewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
});
const tables: InMemoryTables = {
  organization_members: [
    { user_id: callerUser, organization_id: ownOrganization, role: 'admin' },
    { user_id: employeeUser, organization_id: ownOrganization, role: 'employee' },
    { user_id: colleagueUser, organization_id: ownOrganization, role: 'employee' },
    { user_id: strangerUser, organization_id: foreignOrganization, role: 'employee' },
  ],
  time_entries: [
    entry(ownIn, ownOrganization, employeeUser, 'clock_in', yesterday(8)),
    entry(ownOut, ownOrganization, employeeUser, 'clock_out', yesterday(16)),
    entry(colleagueIn, ownOrganization, colleagueUser, 'clock_in', yesterday(8)),
    entry(foreignIn, foreignOrganization, strangerUser, 'clock_in', yesterday(8)),
    entry(callerIn, ownOrganization, callerUser, 'clock_in', today, foreignJob),
    { ...entry(ownPending, ownOrganization, employeeUser, 'clock_in', yesterday(6)), status: 'pending' },
    {
      ...entry(foreignPending, foreignOrganization, strangerUser, 'clock_in', yesterday(6)),
      status: 'pending',
    },
  ],
  entry_change_requests: [
    {
      id: ownEditRequest,
      organization_id: ownOrganization,
      entry_id: colleagueIn,
      paired_entry_id: null,
      requested_by: colleagueUser,
      change_type: 'edit',
      proposed_timestamp: yesterday(8),
      original_timestamp: yesterday(7),
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      created_at: today,
      updated_at: today,
    },
    {
      id: foreignDeleteRequest,
      organization_id: foreignOrganization,
      entry_id: foreignIn,
      paired_entry_id: null,
      requested_by: strangerUser,
      change_type: 'delete',
      proposed_timestamp: null,
      original_timestamp: null,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      created_at: today,
      updated_at: today,
    },
  ],
  jobs: [
    {
      id: ownJob,
      organization_id: ownOrganization,
      title: 'Eigener Auftrag',
      description: null,
      job_number: 'A-1',
      status: 'in_bearbeitung',
      project_id: null,
      client_id: null,
    },
    {
      id: foreignJob,
      organization_id: foreignOrganization,
      title: 'Fremder Auftrag',
      description: null,
      job_number: 'F-1',
      status: 'in_bearbeitung',
      project_id: null,
      client_id: null,
    },
  ],
};
const entryIds = (): string[] => (tables.time_entries ?? []).map((row) => String(row.id)).sort();
const jobOf = (id: string): unknown => (tables.time_entries ?? []).find((row) => row.id === id)?.job_id;
const statusOf = (id: string): unknown => (tables.time_entries ?? []).find((row) => row.id === id)?.status;

// The batch functions are recorded, and can refuse like the database does.
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcRefusal: string | null = null;
/** A table whose reads fail as a dropped connection would. */
let failingReadTable: string | null = null;
const createAdmin = () => {
  const admin = createInMemoryAdmin(tables);
  return {
    ...admin,
    from: (table: string) => {
      const query = admin.from(table);
      if (table === failingReadTable) {
        query.then = (onFulfilled, onRejected) =>
          Promise.resolve({ data: null, error: { code: '08006', message: 'read failed' }, count: null }).then(
            onFulfilled,
            onRejected,
          );
      }
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (rpcRefusal) return { data: null, error: { code: 'P0001', message: rpcRefusal }, count: null };
      return admin.rpc(name, args);
    },
  };
};

let settingsReadFails = false;

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: ownOrganization }) }) }));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: createAdmin }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {},
  getAuthenticatedUser: async () => ({ id: callerUser }),
  getCachedMemberships: async () => [{ orgId: ownOrganization, role: 'admin' }],
  getCachedOrganizationSettings: async () => {
    if (settingsReadFails) throw new Error('organization_settings_read_failed');
    return { breakMode: 'manual', autoBreakThresholdMinutes: 360, autoBreakDurationMinutes: 30 };
  },
  getCachedOrganizationCalendar: async () => null,
}));
// The caller holds the approval responsibility; its resolution has its own tests.
const responsibilities = await import('@/lib/responsibilities/server');
mock.module('@/lib/responsibilities/server', () => ({
  ...responsibilities,
  authorizeResponsibilityForTarget: async () => ({ success: true }),
}));
const {
  addManualEntry,
  deleteEntry,
  deleteEntriesBatch,
  reviewEntries,
  reviewChangeRequest,
  updateEntry,
  getCurrentClockState,
} = await import('@/lib/time-tracking/actions');

// A paired id from another organization or another person deletes nothing,
// not even the authorized entry.
const before = entryIds();
assert.deepEqual(await deleteEntry(ownIn, foreignIn), { success: false, error: 'entry_not_found' });
assert.deepEqual(await deleteEntry(ownIn, colleagueIn), { success: false, error: 'entry_not_found' });
assert.deepEqual(await deleteEntry(foreignIn), { success: false, error: 'not_a_member' });
assert.deepEqual(await deleteEntriesBatch([ownIn, foreignIn]), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(entryIds(), before);

// A job of another organization is never written to an entry.
assert.deepEqual(await updateEntry(colleagueIn, { jobId: foreignJob }), {
  success: false,
  error: 'job_not_found',
});
assert.equal(jobOf(colleagueIn), null);
assert.equal((await updateEntry(colleagueIn, { jobId: ownJob })).success, true);
assert.equal(jobOf(colleagueIn), ownJob);

// The clock state never names a job of another organization, even when a
// stored entry points at one.
const clock = await getCurrentClockState(ownOrganization);
assert.equal(clock.success, true);
if (clock.success) {
  assert.equal(clock.state.activeJobId, foreignJob);
  assert.equal(clock.state.activeJobInfo, null);
}

// The pair of one person in one organization still deletes together.
assert.deepEqual(await deleteEntry(ownIn, ownOut), { success: true });
assert.deepEqual(
  entryIds(),
  before.filter((id) => id !== ownIn && id !== ownOut),
);

// A review that names an entry of another organization refuses the whole
// selection before the database function runs.
rpcCalls.length = 0;
assert.deepEqual(await reviewEntries([ownPending, foreignPending], 'approved'), {
  success: false,
  error: 'invalid_input',
});
assert.deepEqual(await reviewEntries([foreignPending], 'approved'), {
  success: false,
  error: 'not_a_member',
});
assert.deepEqual([ownPending, foreignPending].map(statusOf), ['pending', 'pending']);
assert.deepEqual(rpcCalls, []);

// A refusal of the database function reaches the caller as its failure code;
// an unknown database error stays a generic write failure.
rpcRefusal = 'entry_not_pending';
assert.deepEqual(await reviewEntries([ownPending], 'approved'), {
  success: false,
  error: 'entry_not_pending',
});
rpcRefusal = 'not_authorized';
assert.deepEqual(await deleteEntriesBatch([colleagueIn]), { success: false, error: 'not_authorized' });
rpcRefusal = 'deadlock_detected';
assert.deepEqual(await reviewEntries([ownPending], 'rejected'), { success: false, error: 'update_failed' });
assert.equal(statusOf(ownPending), 'pending');

// A failed read of the entries or of their people is a load failure, never
// "not found", and nothing is reviewed.
rpcCalls.length = 0;
for (const table of ['time_entries', 'organization_members']) {
  failingReadTable = table;
  assert.deepEqual(await reviewEntries([ownPending], 'approved'), { success: false, error: 'fetch_failed' });
}
failingReadTable = null;
assert.deepEqual(rpcCalls, []);
assert.equal(statusOf(ownPending), 'pending');

// The function receives only server-resolved values: the session's user, the
// entries' organization and the people the caller was authorized for.
rpcRefusal = null;
rpcCalls.length = 0;
assert.deepEqual(await reviewEntries([ownPending], 'approved'), { success: true, reviewed: 1 });
assert.deepEqual(rpcCalls, [
  {
    name: 'review_time_entries',
    args: {
      p_actor_id: callerUser,
      p_organization_id: ownOrganization,
      p_entry_ids: [ownPending],
      p_decision: 'approved',
      p_authorized_user_ids: [employeeUser],
    },
  },
]);
assert.equal(statusOf(ownPending), 'approved');

// A change request of another organization is never decided; an own request
// is decided in one database call with server-resolved values only.
rpcCalls.length = 0;
assert.deepEqual(await reviewChangeRequest(foreignDeleteRequest, 'approve'), {
  success: false,
  error: 'not_a_member',
});
assert.deepEqual(rpcCalls, []);
assert.ok(entryIds().includes(foreignIn));
const decided = await reviewChangeRequest(ownEditRequest, 'reject');
assert.equal(decided.success, true);
assert.deepEqual(rpcCalls, [
  {
    name: 'decide_entry_change_request',
    args: {
      p_actor_id: callerUser,
      p_organization_id: ownOrganization,
      p_request_id: ownEditRequest,
      p_decision: 'reject',
    },
  },
]);
assert.deepEqual(await reviewChangeRequest(ownEditRequest, 'approve'), {
  success: false,
  error: 'request_already_reviewed',
});

// Every caller-supplied id and enum is parsed before any read: a malformed
// argument is refused as invalid_input and touches nothing.
const invalid = { success: false, error: 'invalid_input' };
const unchanged = entryIds();
assert.deepEqual(await deleteEntry('colleague-in'), invalid);
assert.deepEqual(await deleteEntry(colleagueIn, 'own-out'), invalid);
assert.deepEqual(await deleteEntriesBatch([colleagueIn, 'caller-in']), invalid);
assert.deepEqual(await updateEntry(colleagueIn, { jobId: 'job-1' }), invalid);
assert.deepEqual(await updateEntry(colleagueIn, { timestamp: 'gestern' }), invalid);
assert.deepEqual(await getCurrentClockState('own-organization'), invalid);
assert.deepEqual(entryIds(), unchanged);

// A failed settings read fails the operation visibly; nothing is computed or
// written with default break settings.
settingsReadFails = true;
assert.deepEqual(await getCurrentClockState(ownOrganization), { success: false, error: 'fetch_failed' });
assert.deepEqual(
  await addManualEntry({
    organizationId: ownOrganization,
    targetUserId: callerUser,
    entries: [{ entryType: 'clock_in', timestamp: yesterday(9) }],
  }),
  { success: false, error: 'fetch_failed' },
);
assert.deepEqual(entryIds(), unchanged);
