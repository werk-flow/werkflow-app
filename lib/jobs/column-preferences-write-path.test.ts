import { beforeEach, expect, mock, test } from 'bun:test';

// The preferences row is one JSON document with several owners (job columns,
// calendar). The column save merged its key into a 300-second cached copy and
// wrote that back, which dropped a calendar preference saved meanwhile.
let storedPreferences: Record<string, unknown> | null;
let preferencesReadError: { code: string; message: string } | null;
let upserts: { preferences: unknown }[];

const admin = {
  from: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: preferencesReadError || !storedPreferences ? null : { preferences: storedPreferences },
        error: preferencesReadError,
      }),
      upsert: async (row: { preferences: unknown }) => {
        upserts.push(row);
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
    expect(stderr).toContain('2 pass');
  },
  30_000,
);

if (ISOLATED) {
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({ updateTag: () => undefined }));
  mock.module('@/lib/jobs/auth', () => ({
    authenticateAndAuthorize: async () => ({ success: true, context: { orgId: 'org', userId: 'user' } }),
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {
      organizationUserPreferences: (organizationId: string, userId: string) =>
        `organization-user-preferences-${organizationId}-${userId}`,
    },
    // A stale cache: it does not know the calendar key yet.
    getCachedOrganizationUserPreferences: async () => ({ visibleColumns: ['nr'], preferences: null }),
  }));

  const { saveAuftraegeColumnPreferences } = await import('./auftraege-column-preferences-actions');

  beforeEach(() => {
    storedPreferences = { calendar: { boardHorizon: 'week' } };
    preferencesReadError = null;
    upserts = [];
  });

  test('saving job columns keeps the other keys of the stored preferences', async () => {
    const result = await saveAuftraegeColumnPreferences({ visibleColumns: ['nr', 'status'] });
    expect(result.success).toBe(true);
    expect(upserts[0]?.preferences).toEqual({
      calendar: { boardHorizon: 'week' },
      auftraege: { visibleColumns: ['nr', 'status'] },
    });
  });

  test('a failed read of the stored preferences writes nothing', async () => {
    preferencesReadError = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await saveAuftraegeColumnPreferences({ visibleColumns: ['nr'] })).toEqual({
      success: false,
      error: 'update_failed',
    });
    expect(upserts).toEqual([]);
  });
}
