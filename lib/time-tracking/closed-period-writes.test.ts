// Manual entries and entry reviews refuse a closed month with period_closed,
// and every legacy entry write maps the database's closed-period refusal
// (SQLSTATE WFP01, a close that won the race against the action's own check)
// to period_closed. The file spawns itself: module mocks stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, test } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';

const FIXTURE_FLAG = 'CLOSED_PERIOD_WRITES_FIXTURE';

const organization = '10000000-0000-4000-8000-000000000001';
const caller = '20000000-0000-4000-8000-000000000001';
const employee = '20000000-0000-4000-8000-000000000002';
const ids = {
  closedPending: '40000000-0000-4000-8000-000000000001',
  openPending: '40000000-0000-4000-8000-000000000002',
  openIn: '40000000-0000-4000-8000-000000000003',
  openOut: '40000000-0000-4000-8000-000000000004',
  openDelete: '50000000-0000-4000-8000-000000000001',
};
const entry = (id: string, entryType: string, timestamp: string, status: string) => ({
  id,
  organization_id: organization,
  user_id: employee,
  entry_type: entryType,
  timestamp,
  job_id: null,
  is_manual: true,
  status,
  reviewed_by: null,
  reviewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
});

async function runFixture(): Promise<void> {
  const tables: InMemoryTables = {
    organization_members: [
      { user_id: caller, organization_id: organization, role: 'admin' },
      { user_id: employee, organization_id: organization, role: 'employee' },
    ],
    time_entries: [
      entry(ids.closedPending, 'clock_in', '2026-03-10T07:00:00.000Z', 'pending'),
      entry(ids.openPending, 'clock_in', '2026-04-08T07:00:00.000Z', 'pending'),
      entry(ids.openIn, 'clock_in', '2026-04-02T07:00:00.000Z', 'approved'),
      entry(ids.openOut, 'clock_out', '2026-04-02T15:00:00.000Z', 'approved'),
    ],
    entry_change_requests: [
      {
        id: ids.openDelete,
        organization_id: organization,
        entry_id: ids.openIn,
        paired_entry_id: ids.openOut,
        requested_by: employee,
        change_type: 'delete',
        proposed_timestamp: null,
        original_timestamp: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        created_at: '2026-04-05T08:00:00.000Z',
        updated_at: '2026-04-05T08:00:00.000Z',
      },
    ],
    time_periods: [
      {
        id: 'march',
        organization_id: organization,
        state: 'closed',
        period_start_date: '2026-03-01',
        period_end_date: '2026-03-31',
      },
    ],
  };
  // While set, every write to time_entries fails like the database trigger,
  // also through the batch functions.
  const database = { refusesEntryWrites: false };
  const triggerRefusal = { data: null, error: { code: 'WFP01', message: 'period_closed' }, count: null };
  const refusingWrites = (query: object): object => {
    let writes = false;
    const proxy: object = new Proxy(query, {
      get(target, property, receiver) {
        if (property === 'then' && writes) {
          return (onFulfilled: (value: typeof triggerRefusal) => unknown) =>
            Promise.resolve(onFulfilled(triggerRefusal));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (property === 'insert' || property === 'update' || property === 'delete') writes = true;
          Reflect.apply(value, target, args);
          return proxy;
        };
      },
    });
    return proxy;
  };
  const createAdmin = () => {
    const admin = createInMemoryAdmin(tables);
    return {
      ...admin,
      from: (table: string) =>
        table === 'time_entries' && database.refusesEntryWrites
          ? refusingWrites(admin.from(table))
          : admin.from(table),
      rpc: async (name: string, args?: Record<string, unknown>) =>
        database.refusesEntryWrites ? triggerRefusal : admin.rpc(name, args),
    };
  };

  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organization }) }) }));
  mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: createAdmin }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {},
    getAuthenticatedUser: async () => ({ id: caller }),
    getCachedMemberships: async () => [{ orgId: organization, role: 'admin' }],
    getCachedOrganizationSettings: async () => ({
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
    }),
    getCachedOrganizationCalendar: async () => null,
  }));
  // The caller holds the approval responsibility; its resolution has its own tests.
  const responsibilities = await import('@/lib/responsibilities/server');
  mock.module('@/lib/responsibilities/server', () => ({
    ...responsibilities,
    authorizeResponsibilityForTarget: async () => ({ success: true }),
  }));
  const { addManualEntry, reviewEntries, updateEntry, deleteEntry, deleteEntriesBatch, reviewChangeRequest } =
    await import('@/lib/time-tracking/actions');
  const refused = { success: false, error: 'period_closed' };
  const entryCount = (): number => (tables.time_entries ?? []).length;
  const statusOf = (table: string, id: string): unknown =>
    (tables[table] ?? []).find((row) => row.id === id)?.status;
  const manualPair = (day: string) => ({
    organizationId: organization,
    targetUserId: employee,
    entries: [
      { entryType: 'clock_in' as const, timestamp: `${day}T07:00:00.000Z` },
      { entryType: 'clock_out' as const, timestamp: `${day}T15:00:00.000Z` },
    ],
  });

  // The action's own check: a closed month gains no entry and keeps its review state.
  assert.deepEqual(await addManualEntry(manualPair('2026-03-12')), refused);
  assert.equal(entryCount(), 4);
  assert.deepEqual(await reviewEntries([ids.closedPending], 'approved'), refused);
  assert.deepEqual(await reviewEntries([ids.openPending, ids.closedPending], 'rejected'), refused);
  assert.deepEqual(
    [ids.closedPending, ids.openPending].map((id) => statusOf('time_entries', id)),
    ['pending', 'pending'],
  );

  // The database refuses although the action saw an open month: a concurrent close won.
  database.refusesEntryWrites = true;
  assert.deepEqual(await addManualEntry(manualPair('2026-04-14')), refused);
  assert.deepEqual(await reviewEntries([ids.openPending], 'approved'), refused);
  assert.deepEqual(await updateEntry(ids.openIn, { timestamp: '2026-04-02T07:30:00.000Z' }), refused);
  assert.deepEqual(await deleteEntry(ids.openIn, ids.openOut), refused);
  assert.deepEqual(await deleteEntriesBatch([ids.openIn]), refused);
  assert.deepEqual(await reviewChangeRequest(ids.openDelete, 'approve'), refused);
  assert.equal(statusOf('entry_change_requests', ids.openDelete), 'pending');

  // Open months stay writable.
  database.refusesEntryWrites = false;
  assert.equal((await addManualEntry(manualPair('2026-04-14'))).success, true);
  assert.equal(entryCount(), 6);
  assert.deepEqual(await reviewEntries([ids.openPending], 'approved'), { success: true, reviewed: 1 });
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('manual entries, reviews and every entry write answer a closed period with period_closed', async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, [FIXTURE_FLAG]: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });
}
