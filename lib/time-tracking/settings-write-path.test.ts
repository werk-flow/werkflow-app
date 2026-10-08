import { beforeEach, expect, mock, test } from 'bun:test';

// The settings write appends to `break_policy_history` and writes it back.
// It read the current value from a 300-second cache, so a second change
// inside that window (or a failed cached read, which yields defaults) dropped
// recorded policy changes. The write path reads the row itself.
// The settings and the break ends of the members on a break are one call of
// update_time_tracking_settings (migration 20261004154000): it receives only
// server-resolved values and the snapshot it re-checks under lock, and a
// refusal changes nothing, so the action revalidates nothing.
type StoredSettings = {
  break_mode: 'manual' | 'automatic';
  auto_break_threshold_minutes: number;
  auto_break_duration_minutes: number;
  break_policy_history: unknown[];
};
type RpcCall = { name: string; args: Record<string, unknown> };

const recordedEntry = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
};
let stored: StoredSettings;
let organizationAdminId: string;
let settingsReadError: { code: string; message: string } | null;
let rpcError: { code: string; message: string } | null;
let todayRows: Record<string, unknown>[];
let rpcCalls: RpcCall[];
let invalidatedTags: string[];

function todayEntry(id: string, entryType: string, minutesAgo: number, jobId: string | null) {
  const timestamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    user_id: 'worker',
    organization_id: 'org',
    entry_type: entryType,
    timestamp,
    is_manual: false,
    job_id: jobId,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

const admin = {
  from: (table: string) => {
    const result = (): { data: unknown; error: { code: string; message: string } | null } => {
      if (table === 'organizations')
        return { data: { id: 'org', admin_id: organizationAdminId }, error: null };
      if (table === 'organization_settings')
        return { data: settingsReadError ? null : stored, error: settingsReadError };
      return { data: [], error: null };
    };
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      lte: () => query,
      order: () => query,
      range: () => query,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        if (table === 'organization_members') resolve({ data: [{ user_id: 'worker' }], error: null });
        else if (table === 'time_entries') resolve({ data: todayRows, error: null });
        else resolve({ data: [], error: null });
      },
    };
    return query;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: null, error: rpcError };
  },
};

// Module mocks are process-wide and a later mock cannot add exports to an
// earlier one, so the mocked scenario runs in its own process.
const ISOLATED = process.env.SETTINGS_WRITE_PATH_ISOLATED === '1';

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'the write path cases pass in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, SETTINGS_WRITE_PATH_ISOLATED: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(
      status,
      `${stdout}
${stderr}`,
    ).toBe(0);
    expect(stderr).toContain('6 pass');
  },
  30_000,
);

if (ISOLATED) {
  mock.module('server-only', () => ({}));
  // The harness gives the action a complete request context: a cookie store
  // and the caller's current membership. The action reads its organization
  // and role from that one membership read (lib/org/action-context.ts).
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
  mock.module('next/cache', () => ({
    updateTag: (tag: string) => {
      invalidatedTags.push(tag);
    },
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {
      organizationSettings: (organizationId: string) => `organization-settings-${organizationId}`,
    },
    getAuthenticatedUser: async () => ({ id: 'owner' }),
    getCachedMemberships: async () => [
      { orgId: 'org', name: 'Org', uniqueCode: 'ORG', role: 'admin', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    // A stale cache: it still reports the state before the recorded history existed.
    getCachedOrganizationSettings: async () => ({
      organizationId: 'org',
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      breakPolicyHistory: [],
    }),
  }));

  const { updateTimeTrackingSettings } = await import('./settings-actions');

  beforeEach(() => {
    stored = {
      break_mode: 'manual',
      auto_break_threshold_minutes: 360,
      auto_break_duration_minutes: 30,
      break_policy_history: [recordedEntry],
    };
    organizationAdminId = 'owner';
    settingsReadError = null;
    rpcError = null;
    todayRows = [];
    rpcCalls = [];
    invalidatedTags = [];
  });

  const change = {
    breakMode: 'automatic',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 45,
  } as const;

  test('a settings change appends to the stored policy history, not to a cached copy', async () => {
    const result = await updateTimeTrackingSettings(change);
    expect(result.success).toBe(true);
    expect(rpcCalls.map((call) => call.name)).toEqual(['update_time_tracking_settings']);
    const history = rpcCalls[0]?.args.p_break_policy_history as { breakMode: string }[];
    expect(history.map((entry) => entry.breakMode)).toEqual(['manual', 'automatic']);
    expect(history[0]).toEqual(recordedEntry);
    // The function refuses when the stored row no longer equals this snapshot.
    expect(rpcCalls[0]?.args.p_expected_settings).toEqual(stored);
    expect(invalidatedTags).toEqual(['organization-settings-org']);
  });

  test('a failed read of the current settings writes nothing', async () => {
    settingsReadError = { code: '57014', message: 'canceling statement due to statement timeout' };
    const result = await updateTimeTrackingSettings(change);
    expect(result).toEqual({ success: false, error: 'update_failed' });
    expect(rpcCalls).toEqual([]);
    expect(invalidatedTags).toEqual([]);
  });

  test('the call carries the server-resolved caller and organization, never client-sent ones', async () => {
    // A forged payload: the schema strips the extra fields, and the function receives the session's values.
    const forged = { ...change, organizationId: 'foreign-org', actorId: 'foreign-admin' };
    const result = await updateTimeTrackingSettings(forged);
    expect(result.success).toBe(true);
    expect(rpcCalls[0]?.args.p_actor_id).toBe('owner');
    expect(rpcCalls[0]?.args.p_organization_id).toBe('org');
  });

  test('a member who is not the admin of the active organization writes nothing', async () => {
    organizationAdminId = 'someone-else';
    const result = await updateTimeTrackingSettings(change);
    expect(result).toEqual({ success: false, error: 'not_authorized' });
    expect(rpcCalls).toEqual([]);
    expect(invalidatedTags).toEqual([]);
  });

  test('the open break of a member ends in the same call and resumes its job', async () => {
    todayRows = [
      todayEntry('entry-1', 'clock_in', 2, 'job-1'),
      todayEntry('entry-2', 'break_start', 1, null),
    ];
    const result = await updateTimeTrackingSettings(change);
    expect(result.success).toBe(true);
    expect(rpcCalls[0]?.args.p_break_ends).toEqual([{ user_id: 'worker', job_id: 'job-1' }]);
  });

  test('a refused call is a failure and revalidates nothing', async () => {
    rpcError = { code: 'P0001', message: 'settings_changed' };
    expect(await updateTimeTrackingSettings(change)).toEqual({ success: false, error: 'update_failed' });
    rpcError = { code: 'P0001', message: 'not_authorized' };
    expect(await updateTimeTrackingSettings(change)).toEqual({ success: false, error: 'not_authorized' });
    rpcError = { code: 'WFP01', message: 'period_closed' };
    expect(await updateTimeTrackingSettings(change)).toEqual({ success: false, error: 'update_failed' });
    expect(invalidatedTags).toEqual([]);
  });
}
