// Today's totals of the clock state keep every minute recorded today: the
// closed segments of every session of the day, open or ended, and the legacy
// entries beside them. A clock-out never resets the day to zero. The file
// spawns itself: module mocks stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, setSystemTime, test } from 'bun:test';
import { getLocalDayStart } from '@/lib/date-time/berlin';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';

const FIXTURE_FLAG = 'CLOCK_DAY_FIXTURE';

const organization = '10000000-0000-4000-8000-000000000001';
const employee = '20000000-0000-4000-8000-000000000001';
const employeeRecord = '30000000-0000-4000-8000-000000000001';
const job = '40000000-0000-4000-8000-000000000001';
const morningSession = '50000000-0000-4000-8000-000000000001';
const afternoonSession = '50000000-0000-4000-8000-000000000002';

/** The fixture's now: 11:00 in Berlin, after every recorded minute below. */
const NOW = new Date('2026-10-27T10:00:00.000Z');

/** An instant of today's Berlin day, `minutes` after its midnight. */
const todayAt = (minutes: number): string =>
  new Date(getLocalDayStart(NOW).getTime() + minutes * 60_000).toISOString();

type SegmentSeed = { id: string; kind: 'work' | 'travel' | 'break'; from: number; to: number | null };

function segmentRow(sessionId: string, seed: SegmentSeed) {
  return {
    id: seed.id,
    session_id: sessionId,
    organization_id: organization,
    employee_record_id: employeeRecord,
    kind: seed.kind,
    allocation_kind: seed.kind === 'break' ? 'none' : 'job',
    job_id: seed.kind === 'break' ? null : job,
    internal_type: null,
    travel_route: seed.kind === 'travel' ? 'company_to_site' : null,
    travel_role: seed.kind === 'travel' ? 'driver' : null,
    standby_context: null,
    started_at: todayAt(seed.from),
    ended_at: seed.to === null ? null : todayAt(seed.to),
  };
}

function sessionRow(id: string, from: number, to: number | null, segments: SegmentSeed[]) {
  return {
    id,
    organization_id: organization,
    user_id: employee,
    employee_record_id: employeeRecord,
    status: 'active',
    started_at: todayAt(from),
    ended_at: to === null ? null : todayAt(to),
    version: 1,
    recovery_reason: null,
    time_segments: segments.map((seed) => segmentRow(id, seed)),
  };
}

async function runFixture(): Promise<void> {
  setSystemTime(NOW);
  const tables: InMemoryTables = {
    time_sessions: [],
    time_entries: [],
    jobs: [
      {
        id: job,
        organization_id: organization,
        title: 'Heizungswartung',
        description: null,
        job_number: 'A-1',
        status: 'in_bearbeitung',
      },
    ],
  };
  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organization }) }) }));
  mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
  mock.module('@/lib/supabase/admin', () => ({
    createSupabaseAdminClient: () => createInMemoryAdmin(tables),
  }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {},
    getAuthenticatedUser: async () => ({ id: employee }),
    getCachedMemberships: async () => [{ orgId: organization, role: 'employee' }],
    getCachedOrganizationSettings: async () => ({
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
    }),
    getCachedOrganizationCalendar: async () => null,
  }));
  const { getCurrentClockState } = await import('./clock-state-actions');
  // The segments also stand as their own table, for the reads that name it.
  const readState = async () => {
    tables.time_segments = (tables.time_sessions ?? []).flatMap((session) =>
      Array.isArray(session.time_segments) ? session.time_segments : [],
    );
    const result = await getCurrentClockState(organization);
    assert.ok(result.success, 'the clock state reads');
    return result.state;
  };

  // Clocked in: two minutes of work closed, the drive still running. The
  // running segment counts on the client from its start, never twice.
  tables.time_sessions = [
    sessionRow(morningSession, 60, null, [
      { id: 'work', kind: 'work', from: 60, to: 62 },
      { id: 'travel', kind: 'travel', from: 62, to: null },
    ]),
  ];
  const running = await readState();
  assert.equal(running.isClockedIn, true);
  assert.equal(running.currentActivity?.kind, 'travel');
  assert.equal(running.statusStartedAt, todayAt(62));
  assert.equal(running.todayMinutes, 2);
  assert.equal(running.travelMinutes, 0);

  // Clocked out: the ended session keeps its minutes, work and travel apart.
  tables.time_sessions = [
    sessionRow(morningSession, 60, 63, [
      { id: 'work', kind: 'work', from: 60, to: 62 },
      { id: 'travel', kind: 'travel', from: 62, to: 63 },
    ]),
  ];
  const stopped = await readState();
  assert.equal(stopped.isClockedIn, false);
  assert.equal(stopped.status, 'clocked_out');
  assert.equal(stopped.todayMinutes, 3, 'a clock-out keeps the day’s presence');
  assert.equal(stopped.workMinutes, 3, 'a clock-out keeps the day’s working time');
  assert.equal(stopped.travelMinutes, 1, 'a clock-out keeps the day’s travel');
  assert.deepEqual(stopped.timelineSegments, [
    { type: 'work', minutes: 2 },
    { type: 'work', minutes: 1 },
  ]);

  // A second session of the day adds to the first, and a manual entry of
  // the day adds to both.
  tables.time_sessions = [
    ...tables.time_sessions,
    sessionRow(afternoonSession, 120, null, [
      { id: 'afternoon-work', kind: 'work', from: 120, to: 130 },
      { id: 'afternoon-break', kind: 'break', from: 130, to: null },
    ]),
  ];
  tables.time_entries = [
    { id: 'manual-in', entry_type: 'clock_in', timestamp: todayAt(30), is_manual: true },
    { id: 'manual-out', entry_type: 'clock_out', timestamp: todayAt(45), is_manual: true },
  ].map((entry) => ({
    ...entry,
    organization_id: organization,
    user_id: employee,
    job_id: null,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    created_at: entry.timestamp,
    updated_at: entry.timestamp,
  }));
  const second = await readState();
  assert.equal(second.isClockedIn, true);
  assert.equal(second.status, 'on_break');
  assert.equal(second.sessionId, afternoonSession);
  assert.equal(second.todayMinutes, 15 + 3 + 10, 'the day counts every session and the manual entry');
  assert.equal(second.travelMinutes, 1);
  assert.equal(second.resumeActivity?.kind, 'work');
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('today’s totals keep their minutes after a clock-out and count every session of the day', async () => {
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
