// The sign-out ends an open session the way the clock would: a session open
// longer than UNUSUALLY_LONG_SESSION_MS, or one the database already marked
// recovery_required, ends through recover_end so the office reviews it; a
// shorter one ends through a plain end. The file spawns itself: module mocks
// stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, setSystemTime, test } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';

const FIXTURE_FLAG = 'SIGN_OUT_SESSION_END_FIXTURE';
const HOUR_MS = 60 * 60 * 1000;

const user = '20000000-0000-4000-8000-000000000001';
const sessions = {
  thirtyHours: { id: '30000000-0000-4000-8000-000000000001', org: '10000000-0000-4000-8000-000000000001' },
  twoHours: { id: '30000000-0000-4000-8000-000000000002', org: '10000000-0000-4000-8000-000000000002' },
  flagged: { id: '30000000-0000-4000-8000-000000000003', org: '10000000-0000-4000-8000-000000000003' },
};

async function runFixture(): Promise<void> {
  const now = Date.parse('2026-03-04T08:00:00.000Z');
  setSystemTime(now);
  const openSession = (
    session: { id: string; org: string },
    openForMs: number,
    status: 'open' | 'recovery_required',
  ) => ({
    id: session.id,
    organization_id: session.org,
    user_id: user,
    status,
    version: 3,
    started_at: new Date(now - openForMs).toISOString(),
    ended_at: null,
  });
  const tables: InMemoryTables = {
    time_entries: [],
    time_sessions: [
      openSession(sessions.thirtyHours, 30 * HOUR_MS, 'open'),
      openSession(sessions.twoHours, 2 * HOUR_MS, 'open'),
      openSession(sessions.flagged, 2 * HOUR_MS, 'recovery_required'),
    ],
  };
  // Each transition the sign-out sends, answered as the database ends it.
  const transitions: Record<string, unknown>[] = [];
  const createAdmin = () => ({
    ...createInMemoryAdmin(tables),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      assert.equal(name, 'transition_time_activity');
      transitions.push(args);
      return { data: { outcome: 'ended', version: 4 }, error: null, count: null };
    },
  });

  mock.module('server-only', () => ({}));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: createAdmin }));
  const cached = await import('@/lib/data/cached');
  mock.module('@/lib/data/cached', () => ({ ...cached, getAuthenticatedUser: async () => ({ id: user }) }));
  const { clockOutBeforeSignOut } = await import('@/lib/time-tracking/clock-state-actions');

  const result = await clockOutBeforeSignOut();
  assert.equal(result.success, true, JSON.stringify(result));

  const sent = (session: { id: string }) =>
    transitions
      .filter((args) => args.p_expected_session_id === session.id)
      .map((args) => ({ action: args.p_action, acknowledgeLong: args.p_acknowledge_long }));
  assert.deepEqual(
    sent(sessions.thirtyHours),
    [{ action: 'recover_end', acknowledgeLong: true }],
    "a session open 30 hours ends with the recovery marker, not as the person's own end",
  );
  assert.deepEqual(
    sent(sessions.twoHours),
    [{ action: 'end', acknowledgeLong: false }],
    "a session open 2 hours ends as the person's own end",
  );
  assert.deepEqual(
    sent(sessions.flagged),
    [{ action: 'recover_end', acknowledgeLong: true }],
    'a session the database marked recovery_required ends through recover_end',
  );
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('sign-out ends a session open longer than 24 hours through recover_end, a shorter one through end', async () => {
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
