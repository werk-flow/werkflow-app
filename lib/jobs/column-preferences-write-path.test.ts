import { beforeEach, expect, mock, test } from 'bun:test';

import { DEFAULT_CALENDAR_PREFERENCES } from '@/lib/calendar/preferences';

// The preferences row is one JSON document with several owners (job columns,
// calendar). Each save read the whole document, merged its own key and wrote
// the document back, so two saves of different keys in one round trip lost
// the first. A save now sets its one key through set_organization_user_preference
// (migration 20261006150000; sql:user-preference-writes proves the merge).
const ORGANIZATION_ID = '6a000000-0000-4000-8000-000000000001';
const USER_ID = '6a000000-0000-4000-8000-000000000002';

type Document = Record<string, unknown>;
type RpcCall = {
  name: string;
  args: { p_organization_id: string; p_user_id: string; p_path: string[]; p_value: unknown };
};

let stored: Document;
let rpcCalls: RpcCall[];
let tableCalls: string[];
let rpcError: { code: string; message: string } | null;

// Every database step yields once, so two saves started together interleave
// the way two requests on the server do.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setKey(document: Document, path: string[], value: unknown): Document {
  const [head, child] = path;
  if (head === undefined) return document;
  if (child === undefined) return { ...document, [head]: value };
  const parent = document[head];
  const base = parent && typeof parent === 'object' && !Array.isArray(parent) ? parent : {};
  return { ...document, [head]: { ...base, [child]: value } };
}

const admin = {
  rpc: async (name: string, args: RpcCall['args']) => {
    rpcCalls.push({ name, args });
    await tick();
    if (rpcError) return { error: rpcError };
    // The database merges into the latest stored version in one statement.
    stored = setKey(stored, args.p_path, args.p_value);
    return { error: null };
  },
  // A whole-document read and write-back: a regression to it loses a key.
  from: (table: string) => {
    tableCalls.push(table);
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => {
        const snapshot = stored;
        await tick();
        return { data: { preferences: snapshot }, error: null };
      },
      upsert: async (row: { preferences: Document }) => {
        await tick();
        stored = row.preferences;
        return { error: null };
      },
    };
    return query;
  },
};

// Module mocks are process-wide and a later mock cannot add exports to an
// earlier one, so the mocked scenario runs in its own process.
const ISOLATED = process.env.COLUMN_PREFERENCES_WRITE_PATH_ISOLATED === '1';

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'the write path cases pass in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, COLUMN_PREFERENCES_WRITE_PATH_ISOLATED: '1' },
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
    expect(stderr).toContain('3 pass');
  },
  30_000,
);

if (ISOLATED) {
  const loggedErrors: string[] = [];
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({ updateTag: () => undefined }));
  mock.module('@/lib/logging', () => ({ logError: (message: string) => loggedErrors.push(message) }));
  mock.module('@/lib/jobs/auth', () => ({
    authenticateAndAuthorize: async () => ({
      success: true,
      context: { orgId: ORGANIZATION_ID, userId: USER_ID },
    }),
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {
      organizationUserPreferences: (organizationId: string, userId: string) =>
        `organization-user-preferences-${organizationId}-${userId}`,
    },
  }));

  const { saveAuftraegeColumnPreferences } = await import('./auftraege-column-preferences-actions');
  const { saveCalendarPreferences } = await import('@/lib/calendar/preferences-actions');
  const calendar = { ...DEFAULT_CALENDAR_PREFERENCES, horizonWeeks: 2 };

  beforeEach(() => {
    stored = { auftraege: { density: 'compact' }, other: 1 };
    rpcCalls = [];
    tableCalls = [];
    rpcError = null;
    loggedErrors.length = 0;
  });

  test('two concurrent saves of different keys both survive, each through one call that sets only its key', async () => {
    const [columns, calendarSave] = await Promise.all([
      saveAuftraegeColumnPreferences({ visibleColumns: ['nr', 'status'] }),
      saveCalendarPreferences(ORGANIZATION_ID, calendar),
    ]);

    expect(columns).toEqual({ success: true, visibleColumns: ['nr', 'status'] });
    expect(calendarSave).toEqual({ success: true });
    expect(tableCalls).toEqual([]);
    expect(rpcCalls).toEqual<RpcCall[]>([
      {
        name: 'set_organization_user_preference',
        args: {
          p_organization_id: ORGANIZATION_ID,
          p_user_id: USER_ID,
          p_path: ['auftraege', 'visibleColumns'],
          p_value: ['nr', 'status'],
        },
      },
      {
        name: 'set_organization_user_preference',
        args: {
          p_organization_id: ORGANIZATION_ID,
          p_user_id: USER_ID,
          p_path: ['calendar'],
          p_value: calendar,
        },
      },
    ]);
    expect(stored).toEqual({
      auftraege: { density: 'compact', visibleColumns: ['nr', 'status'] },
      calendar,
      other: 1,
    });
  });

  test('a refusal of the database keeps its code', async () => {
    rpcError = { code: 'P0001', message: 'not_a_member' };
    expect(await saveAuftraegeColumnPreferences({ visibleColumns: ['nr'] })).toEqual({
      success: false,
      error: 'not_a_member',
    });
    expect(await saveCalendarPreferences(ORGANIZATION_ID, calendar)).toEqual({
      success: false,
      error: 'not_a_member',
    });
    expect(loggedErrors).toEqual([]);
  });

  test('a failed write reports update_failed and logs it', async () => {
    rpcError = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await saveAuftraegeColumnPreferences({ visibleColumns: ['nr'] })).toEqual({
      success: false,
      error: 'update_failed',
    });
    expect(await saveCalendarPreferences(ORGANIZATION_ID, calendar)).toEqual({
      success: false,
      error: 'update_failed',
    });
    expect(loggedErrors).toEqual([
      'Error saving Auftraege column preferences',
      'Error saving calendar preferences',
    ]);
    expect(stored).toEqual({ auftraege: { density: 'compact' }, other: 1 });
  });
}
