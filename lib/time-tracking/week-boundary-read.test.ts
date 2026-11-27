// The week's read keeps the minutes of a shift that ends at the midnight after
// its Sunday: `getTimeEntries` reaches the clock-out that closes the window's
// last day, whether a legacy entry, an approved correction or a segment holds
// it, and never the next week's start. The file spawns itself: module mocks
// stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, setSystemTime, test } from 'bun:test';
import { resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import type { BreakPolicy } from './settings';

const FIXTURE_FLAG = 'WEEK_BOUNDARY_READ_FIXTURE';

const organization = '10000000-0000-4000-8000-000000000001';
const employee = '20000000-0000-4000-8000-000000000001';
const employeeRecord = '30000000-0000-4000-8000-000000000001';
const session = '50000000-0000-4000-8000-000000000001';

function berlin(localDateTime: string): string {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error(`Not a Berlin wall time: ${localDateTime}`);
  return resolved.instant.toISOString();
}

/** The week of Monday 23 November 2026, read on the Wednesday after it. */
const MONDAY = berlin('2026-11-23T00:00');
const NEXT_MONDAY = berlin('2026-11-30T00:00');
const SUNDAY_END = new Date(Date.parse(NEXT_MONDAY) - 1).toISOString();

const MANUAL_RULE: BreakPolicy = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

function legacyEntry(id: string, entryType: 'clock_in' | 'clock_out', timestamp: string) {
  return {
    id,
    organization_id: organization,
    user_id: employee,
    entry_type: entryType,
    timestamp,
    is_manual: true,
    job_id: null,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function runFixture(): Promise<void> {
  setSystemTime(new Date(berlin('2026-12-02T12:00')));
  let applications: TimeCorrectionApplicationProjection[] = [];
  const tables: InMemoryTables = {
    time_entries: [],
    time_segments: [],
    employee_records: [{ id: employeeRecord, organization_id: organization, user_id: employee }],
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
    getOwnEmployeeRecordId: async () => employeeRecord,
  }));
  mock.module('@/lib/time-corrections/approved-projection', () => ({
    loadApprovedCorrectionProjection: async () => applications,
  }));
  mock.module('@/lib/time-corrections/actions', () => ({
    getProvisionalTimeCorrectionProjection: async () => ({ entries: [], sources: [] }),
  }));
  const { getTimeEntries } = await import('./entry-read-actions');
  const { buildWeeklyTimeData } = await import('./weekly');

  /** Sunday's presence in the week, read as the Zeiterfassung and the Mitarbeiter detail read it. */
  const sundayPresence = async (): Promise<number | undefined> => {
    const result = await getTimeEntries({
      organizationId: organization,
      from: MONDAY,
      to: SUNDAY_END,
      userId: employee,
    });
    assert.ok(result.success, 'the week reads');
    assert.ok(
      result.entries.every((entry) => entry.entryType === 'clock_out' || entry.timestamp <= SUNDAY_END),
      'only the clock-out that closes Sunday lies past the window',
    );
    return buildWeeklyTimeData(result.entries, new Date(MONDAY), MANUAL_RULE).at(-1)?.totalMinutes;
  };

  // A legacy shift that ends at midnight; the next week's start stays out.
  tables.time_entries = [
    legacyEntry('sunday-in', 'clock_in', berlin('2026-11-29T22:00')),
    legacyEntry('sunday-out', 'clock_out', NEXT_MONDAY),
    legacyEntry('next-week-in', 'clock_in', NEXT_MONDAY),
  ];
  assert.equal(await sundayPresence(), 120, 'a legacy clock-out at midnight closes Sunday');

  // An approved correction moves the legacy shift to start at 23:30 and still end at midnight.
  const fact = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
    factId: entryType,
    employeeRecordId: employeeRecord,
    userId: employee,
    entryType,
    timestamp,
    jobId: null,
    activityKind: 'work' as const,
    isManual: false,
  });
  applications = [
    {
      applicationId: 'moved-shift',
      requestId: 'request-moved-shift',
      appliedAt: berlin('2026-12-01T09:00'),
      appliedBy: employee,
      sourceFingerprint: 'moved-shift',
      snapshot: {
        schemaVersion: 1,
        facts: [fact('clock_in', berlin('2026-11-29T23:30')), fact('clock_out', NEXT_MONDAY)],
      },
      sources: [
        { kind: 'legacy_entry', id: 'sunday-in', version: '1' },
        { kind: 'legacy_entry', id: 'sunday-out', version: '1' },
      ],
    },
  ];
  assert.equal(await sundayPresence(), 30, 'a corrected clock-out at midnight closes Sunday');

  // A segment that runs past midnight closes Sunday there, to the minute.
  applications = [];
  tables.time_entries = [];
  tables.time_segments = [
    {
      id: 'night-shift',
      session_id: session,
      organization_id: organization,
      employee_record_id: employeeRecord,
      kind: 'work',
      allocation_kind: 'unallocated',
      job_id: null,
      internal_type: null,
      travel_route: null,
      travel_role: null,
      standby_context: null,
      started_at: berlin('2026-11-29T23:00'),
      ended_at: berlin('2026-11-30T01:00'),
      created_at: berlin('2026-11-29T23:00'),
      updated_at: berlin('2026-11-30T01:00'),
    },
  ];
  assert.equal(await sundayPresence(), 60, 'a night segment keeps its Sunday hour');
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('the week keeps the minutes of a shift that ends at the midnight after its Sunday', async () => {
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
