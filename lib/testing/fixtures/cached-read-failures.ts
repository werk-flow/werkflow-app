// The real cross-request readers with only the database and Next's cache
// replaced. The cache stand-in behaves like `unstable_cache`: it stores a
// resolved value under its key and stores nothing when the read rejects.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';

const stored = new Map<string, unknown>();
mock.module('next/cache', () => ({
  unstable_cache:
    <Arguments extends unknown[], Result>(read: (...args: Arguments) => Promise<Result>, keys: string[]) =>
    async (...args: Arguments): Promise<unknown> => {
      const key = JSON.stringify([keys, args]);
      if (stored.has(key)) return stored.get(key);
      const value = await read(...args);
      stored.set(key, value);
      return value;
    },
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
mock.module('@/lib/profile-avatar', () => ({ getProfileAvatarUrl: () => null }));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  }),
}));

const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

// One database: a table fails while its name is in `failing`; every read is counted.
const failing = new Set<string>();
const reads = new Map<string, number>();
const failure = { code: 'XX000', message: 'private row detail', details: 'customer@example.invalid' };
const rowsByTable: Record<string, { single: unknown; many: unknown[]; count?: number }> = {
  subscriptions: { single: { status: 'active' }, many: [] },
  organization_settings: {
    single: {
      organization_id: organizationId,
      break_mode: 'automatic',
      auto_break_threshold_minutes: 360,
      auto_break_duration_minutes: 45,
      break_policy_history: [],
      holiday_region: 'DE-BY',
      holiday_region_history: [],
    },
    many: [],
  },
  organization_closure_days: {
    single: null,
    many: [{ id: 'closure', closure_date: '2026-12-24', label: 'Heiligabend' }],
  },
  organization_user_preferences: { single: { preferences: { auftraegeColumns: ['nummer'] } }, many: [] },
  profiles: { single: { id: userId, first_name: 'Erika', last_name: 'Muster', avatar_path: null }, many: [] },
  organization_members: {
    single: null,
    count: 3,
    many: [
      {
        organization_id: organizationId,
        role: 'employee',
        joined_at: '2026-01-01T00:00:00Z',
        organizations: {
          id: organizationId,
          name: 'Muster SHK',
          unique_code: 'ABC123',
          employee_records: [],
        },
      },
    ],
  },
};

function answer(table: string, shape: 'single' | 'many'): Promise<Record<string, unknown>> {
  reads.set(table, (reads.get(table) ?? 0) + 1);
  if (failing.has(table)) return Promise.resolve({ data: null, error: failure, count: null });
  const rows = rowsByTable[table] ?? { single: null, many: [] };
  return Promise.resolve(
    shape === 'single'
      ? { data: rows.single, error: null }
      : { data: rows.many, error: null, count: rows.count ?? null },
  );
}

function tableQuery(table: string): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'range',
    'limit',
  ]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => answer(table, 'single');
  query.single = () => answer(table, 'single');
  query.then = (
    resolve: (value: Record<string, unknown>) => unknown,
    reject: (reason: unknown) => unknown,
  ): Promise<unknown> => answer(table, 'many').then(resolve, reject);
  return query;
}
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => tableQuery(table) }),
}));

const cached = await import('@/lib/data/cached');
const { CachedReadError } = await import('@/lib/data/cached-read-failure');

async function expectNoCachedFailure(input: {
  table: string;
  code: string;
  read: () => Promise<unknown>;
  check: (value: unknown) => void;
}): Promise<void> {
  const before = reads.get(input.table) ?? 0;
  const logsBefore = logged.length;
  failing.add(input.table);
  await assert.rejects(input.read(), (error: unknown) => {
    assert.ok(error instanceof CachedReadError, `${input.code}: a failed read must throw CachedReadError`);
    assert.equal(error.code, input.code);
    return true;
  });
  assert.equal(logged.length, logsBefore + 1, `${input.code}: the failure is logged once`);
  assert.match(logged.at(-1) ?? '', /"code":"XX000"/);
  assert.doesNotMatch(logged.at(-1) ?? '', /private row detail|customer@example/);

  failing.delete(input.table);
  input.check(await input.read());
  const afterRecovery = reads.get(input.table) ?? 0;
  assert.ok(afterRecovery > before + 1, `${input.code}: the read after a failure goes to the database again`);

  input.check(await input.read());
  assert.equal(reads.get(input.table), afterRecovery, `${input.code}: a successful read is cached`);
}

await expectNoCachedFailure({
  table: 'subscriptions',
  code: 'subscription_read_failed',
  read: () => cached.getCachedSubscriptionStatus(userId),
  check: (value) => assert.equal(value, true),
});
await expectNoCachedFailure({
  table: 'organization_members',
  code: 'member_count_read_failed',
  read: () => cached.getCachedMemberCount(organizationId),
  check: (value) => assert.equal(value, 3),
});
await expectNoCachedFailure({
  table: 'organization_settings',
  code: 'organization_settings_read_failed',
  read: () => cached.getCachedOrganizationSettings(organizationId),
  check: (value) => assert.equal((value as { breakMode: string }).breakMode, 'automatic'),
});
await expectNoCachedFailure({
  table: 'organization_closure_days',
  code: 'organization_calendar_read_failed',
  read: () => cached.getCachedOrganizationCalendar(organizationId),
  check: (value) => assert.equal((value as { closureDays: unknown[] }).closureDays.length, 1),
});
await expectNoCachedFailure({
  table: 'organization_user_preferences',
  code: 'organization_user_preferences_read_failed',
  read: () => cached.getCachedOrganizationUserPreferences(organizationId, userId),
  check: (value) => assert.ok(value),
});
await expectNoCachedFailure({
  table: 'profiles',
  code: 'profile_read_failed',
  read: () => cached.getCachedUserProfile(userId, 'erika@example.invalid'),
  check: (value) => assert.equal((value as { firstName: string }).firstName, 'Erika'),
});

// A read-only view renders the default columns for the failed request only.
const viewUser = '20000000-0000-4000-8000-000000000003';
failing.add('organization_user_preferences');
const degraded = await cached.getOrganizationUserPreferencesForView(organizationId, viewUser);
assert.equal(degraded.preferences, null);
failing.delete('organization_user_preferences');
const recovered = await cached.getOrganizationUserPreferencesForView(organizationId, viewUser);
assert.notEqual(recovered.preferences, null, 'the saved choice returns once the read succeeds');

// A time computation never runs on default break rules: with the settings
// read failing, the clock state is a failure, not a state built on defaults.
const otherOrganization = '10000000-0000-4000-8000-000000000004';
rowsByTable.organization_members = {
  single: null,
  many: [
    {
      organization_id: otherOrganization,
      role: 'employee',
      joined_at: '2026-01-01T00:00:00Z',
      organizations: {
        id: otherOrganization,
        name: 'Zweite SHK',
        unique_code: 'XYZ789',
        employee_records: [],
      },
    },
  ],
};
const { getCurrentClockState } = await import('@/lib/time-tracking/actions');
failing.add('organization_settings');
const settingsReadsBefore = reads.get('organization_settings') ?? 0;
const clockState = await getCurrentClockState(otherOrganization);
assert.equal(clockState.success, false, 'a failed settings read must fail the clock state');
const secondClockState = await getCurrentClockState(otherOrganization);
assert.equal(secondClockState.success, false);
assert.ok(
  (reads.get('organization_settings') ?? 0) >= settingsReadsBefore + 2,
  'each attempt reads the settings again',
);
failing.delete('organization_settings');
const healthyClockState = await getCurrentClockState(otherOrganization);
assert.equal(healthyClockState.success, true, 'the same call succeeds once the settings read does');
