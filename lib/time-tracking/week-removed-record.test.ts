// The week (Zeiterfassung) and the member status (Mitarbeiter list and detail)
// count only the approved and pending correction facts of the person's
// effective employee record, and mark no entry with a pending request filed on
// a record they no longer hold. A person whose record was removed and who holds a
// new one sees none of the facts the old record retains, in their own week and
// in the office's view of them (docs/technical/security.md, "Calendar correction input boundary";
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
const removedMarkedEntry = '40000000-0000-4000-8000-000000000001';
const currentMarkedEntry = '40000000-0000-4000-8000-000000000002';

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
  /** A recorded clock-in of the employee's that a pending proposal would change. */
  const clockIn = (id: string, localDateTime: string) => ({
    id,
    organization_id: organization,
    user_id: employee,
    entry_type: 'clock_in',
    timestamp: berlin(localDateTime),
    job_id: null,
    status: 'approved',
    is_manual: false,
    reviewed_by: null,
    reviewed_at: null,
    created_at: berlin(localDateTime),
    updated_at: berlin(localDateTime),
  });
  const tables: InMemoryTables = {
    time_entries: [
      clockIn(removedMarkedEntry, '2026-11-23T07:00'),
      clockIn(currentMarkedEntry, '2026-11-26T07:00'),
    ],
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
  }));
  // As read_time_correction_applications filters by person: every application with one of their facts.
  mock.module('@/lib/time-corrections/approved-projection', () => ({
    loadApprovedCorrectionProjection: async (_admin: unknown, input: { userIds?: string[] }) =>
      applications.filter((application) =>
        application.snapshot.facts.some((fact) => !input.userIds || input.userIds.includes(fact.userId)),
      ),
  }));
  // Two pending proposals of a Wednesday shift, one on each record; the real
  // provisional projection reads them.
  const proposal = (id: string, employeeRecordId: string) => ({
    id,
    kind: 'add' as const,
    currentRevision: 1,
    updatedAt: berlin('2026-11-25T10:00'),
    subjectEmployeeRecordId: employeeRecordId,
    subjectUserId: employee,
    proposedSnapshot: {
      schemaVersion: 1 as const,
      facts: addedShift(id, employeeRecordId).snapshot.facts.map((fact) => ({
        ...fact,
        timestamp: new Date(Date.parse(fact.timestamp) + 24 * 3600_000).toISOString(),
      })),
    },
  });
  // Each proposal would also change one recorded clock-in.
  const source = (requestId: string, timeEntryId: string) => ({
    correction_application_id: null,
    ordinal: 0,
    organization_id: organization,
    request_id: requestId,
    revision: 1,
    source_kind: 'legacy_entry' as const,
    source_version: '1',
    time_entry_id: timeEntryId,
    time_segment_id: null,
    time_session_id: null,
  });
  mock.module('@/lib/time-corrections/pending-projection', () => ({
    createPendingProjectionPort: () => ({}),
    loadPendingCorrectionProjection: async () => ({
      requests: [proposal('pending-removed', removedRecord), proposal('pending-current', currentRecord)],
      sources: [source('pending-removed', removedMarkedEntry), source('pending-current', currentMarkedEntry)],
    }),
  }));
  const { getTimeEntries } = await import('./entry-read-actions');

  /** The week of the employee, or with `whole` the organization's, as the member status reads it. */
  const correctionIds = async (whole = false): Promise<string[]> => {
    const result = await getTimeEntries({
      organizationId: organization,
      from: MONDAY,
      to: SUNDAY_END,
      ...(whole ? {} : { userId: employee }),
    });
    assert.ok(result.success, 'the week reads');
    return [...result.entries, ...(result.provisionalEntries ?? [])]
      .flatMap((entry) =>
        entry.id === removedMarkedEntry || entry.id === currentMarkedEntry
          ? entry.pendingCorrectionRequestId
            ? [`marked:${entry.id}:${entry.pendingCorrectionRequestId}`]
            : []
          : [entry.id],
      )
      .sort();
  };
  const currentFacts = [
    'correction:current:current-clock_in',
    'correction:current:current-clock_out',
    `marked:${currentMarkedEntry}:pending-current`,
    'proposal:pending-current:1:pending-current-clock_in',
    'proposal:pending-current:1:pending-current-clock_out',
  ];

  // Zeiterfassung: the employee's own week.
  assert.deepEqual(await correctionIds(), currentFacts, 'the own week counts no fact of the removed record');

  // Mitarbeiter detail: the office's week of the employee.
  caller = { id: admin, role: 'admin' };
  assert.deepEqual(
    await correctionIds(),
    currentFacts,
    'the member week counts no fact of the removed record',
  );

  // Mitarbeiter list and detail status: the office reads the whole organization's day.
  assert.deepEqual(
    await correctionIds(true),
    currentFacts,
    'the member status counts no fact of the removed record',
  );

  // Without a record the member holds now, no fact counts.
  tables.employee_records = [{ id: removedRecord, organization_id: organization, user_id: null }];
  assert.deepEqual(await correctionIds(), [], 'a member without a record shows no correction fact');
  assert.deepEqual(
    await correctionIds(true),
    [],
    'the organization shows no fact of a person without a record',
  );
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
