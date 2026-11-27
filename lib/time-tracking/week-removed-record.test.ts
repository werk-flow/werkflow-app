// The week (Zeiterfassung) and the member status (Mitarbeiter detail) count
// only the correction facts of the person's effective employee record. A
// person whose record was removed and who holds a new one sees none of the
// facts the old record retains, in their own week and in the office's view of
// them (docs/technical/security.md, "Calendar correction input boundary";
// werk-flow/werkflow-planning#610). The file spawns itself: module mocks stay
// in the child.
import assert from 'node:assert/strict';
import { expect, mock, setSystemTime, test } from 'bun:test';
import { resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';

const FIXTURE_FLAG = 'WEEK_REMOVED_RECORD_FIXTURE';

const organization = '10000000-0000-4000-8000-000000000001';
const employee = '20000000-0000-4000-8000-000000000001';
const admin = '20000000-0000-4000-8000-000000000002';
const removedRecord = '30000000-0000-4000-8000-000000000001';
const currentRecord = '30000000-0000-4000-8000-000000000002';

function berlin(localDateTime: string): string {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error(`Not a Berlin wall time: ${localDateTime}`);
  return resolved.instant.toISOString();
}

const MONDAY = berlin('2026-11-23T00:00');
const SUNDAY_END = new Date(Date.parse(berlin('2026-11-30T00:00')) - 1).toISOString();

/** An approved correction that added a shift on Tuesday to the employee's time on one record. */
function addedShift(id: string, employeeRecordId: string): TimeCorrectionApplicationProjection {
  const fact = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
    factId: `${id}-${entryType}`,
    employeeRecordId,
    userId: employee,
    entryType,
    timestamp,
    jobId: null,
    activityKind: 'work' as const,
    isManual: true,
  });
  return {
    applicationId: id,
    requestId: `request-${id}`,
    appliedAt: berlin('2026-11-25T09:00'),
    appliedBy: admin,
    sourceFingerprint: id,
    snapshot: {
      schemaVersion: 1,
      facts: [fact('clock_in', berlin('2026-11-24T07:00')), fact('clock_out', berlin('2026-11-24T11:00'))],
    },
    sources: [],
  };
}

async function runFixture(): Promise<void> {
  setSystemTime(new Date(berlin('2026-11-26T12:00')));
  let caller: { id: string; role: 'employee' | 'admin' } = { id: employee, role: 'employee' };
  const tables: InMemoryTables = {
    time_entries: [],
    time_segments: [],
    // The employee's old record lost its login; they hold a new one.
    employee_records: [
      { id: removedRecord, organization_id: organization, user_id: null },
      { id: currentRecord, organization_id: organization, user_id: employee },
    ],
  };
  const applications = [addedShift('removed', removedRecord), addedShift('current', currentRecord)];
  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organization }) }) }));
  mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
  mock.module('@/lib/supabase/admin', () => ({
    createSupabaseAdminClient: () => createInMemoryAdmin(tables),
  }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {},
    getAuthenticatedUser: async () => ({ id: caller.id }),
    getCachedMemberships: async () => [{ orgId: organization, role: caller.role }],
    getOwnEmployeeRecordId: async (userId: string) => (userId === employee ? currentRecord : null),
  }));
  // As read_time_correction_applications filters by person: every application with one of their facts.
  mock.module('@/lib/time-corrections/approved-projection', () => ({
    loadApprovedCorrectionProjection: async (_admin: unknown, input: { userIds?: string[] }) =>
      applications.filter((application) =>
        application.snapshot.facts.some((fact) => !input.userIds || input.userIds.includes(fact.userId)),
      ),
  }));
  mock.module('@/lib/time-corrections/actions', () => ({
    getProvisionalTimeCorrectionProjection: async () => ({ entries: [], sources: [] }),
  }));
  const { getTimeEntries } = await import('./entry-read-actions');

  const correctionIds = async (): Promise<string[]> => {
    const result = await getTimeEntries({
      organizationId: organization,
      from: MONDAY,
      to: SUNDAY_END,
      userId: employee,
    });
    assert.ok(result.success, 'the week reads');
    return result.entries.map((entry) => entry.id).sort();
  };
  const currentFacts = ['correction:current:current-clock_in', 'correction:current:current-clock_out'];

  // Zeiterfassung: the employee's own week.
  assert.deepEqual(await correctionIds(), currentFacts, 'the own week counts no fact of the removed record');

  // Mitarbeiter detail: the office's view of the employee.
  caller = { id: admin, role: 'admin' };
  assert.deepEqual(
    await correctionIds(),
    currentFacts,
    'the member status counts no fact of the removed record',
  );

  // Without a record the member holds now, no fact counts.
  tables.employee_records = [{ id: removedRecord, organization_id: organization, user_id: null }];
  assert.deepEqual(await correctionIds(), [], 'a member without a record shows no correction fact');
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('the week and the member status count no correction fact of a removed employee record', async () => {
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
