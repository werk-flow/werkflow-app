// The correction request list and „Vorgemerkte Zeit“ show only the requests of
// the employee record their subject holds now. A person whose old record was
// removed and who holds a new one sees none of the old record's requests: not
// in the count, minutes and days of the summary, and not in the request cards,
// their own or the office's (docs/technical/security.md, "Calendar correction
// input boundary"; werk-flow/werkflow-planning#613).
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const removedRecord = '8a000000-0000-4000-8000-000000000001';
const currentRecord = '8a000000-0000-4000-8000-000000000002';
const removedRequest = '8a000000-0000-4000-8000-000000000011';
const currentRequest = '8a000000-0000-4000-8000-000000000012';

/** A submitted request that adds a shift of `hours` on 4 March to the caller's time on one record. */
function addedShift(id: string, employeeRecordId: string, hours: number) {
  const fact = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
    factId: entryType,
    employeeRecordId,
    userId: CALLER_ID,
    entryType,
    timestamp,
    jobId: null,
    activityKind: 'work',
    isManual: true,
  });
  return {
    request: {
      id,
      organization_id: ORGANIZATION_A,
      subject_employee_record_id: employeeRecordId,
      subject_user_id: CALLER_ID,
      requested_by: CALLER_ID,
      kind: 'add',
      status: 'submitted',
      current_revision: 1,
      created_at: '2026-03-05T08:00:00.000Z',
      updated_at: '2026-03-05T08:00:00.000Z',
    },
    revision: {
      organization_id: ORGANIZATION_A,
      request_id: id,
      revision: 1,
      reason: 'Vergessen',
      source_fingerprint: id,
      before_snapshot: { schemaVersion: 1, facts: [] },
      proposed_snapshot: {
        schemaVersion: 1,
        facts: [
          fact('clock_in', '2026-03-04T07:00:00.000Z'),
          fact(
            'clock_out',
            new Date(Date.parse('2026-03-04T07:00:00.000Z') + hours * 3_600_000).toISOString(),
          ),
        ],
      },
      created_by: CALLER_ID,
      created_at: '2026-03-05T08:00:00.000Z',
    },
  };
}
const removed = addedShift(removedRequest, removedRecord, 2);
const current = addedShift(currentRequest, currentRecord, 4);

/** An employee record as the responsibility read embeds its access lifecycle and blockers. */
const record = (id: string, userId: string | null) => ({
  id,
  organization_id: ORGANIZATION_A,
  user_id: userId,
  exit_date: null,
  personnel_access_lifecycles: [],
  personnel_onboarding_requirements: [],
});
const world = installActionWorld({
  // The caller's old record lost its login; they hold a new one.
  employee_records: [record(removedRecord, null), record(currentRecord, CALLER_ID)],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' }],
  time_correction_requests: [removed.request, current.request],
  time_correction_request_revisions: [removed.revision, current.revision],
  time_entries: [],
});
const { getProvisionalTimeSummary, getTimeCorrectionRequests } = await import(
  '@/lib/time-corrections/read-actions'
);

const summary = () => getProvisionalTimeSummary({ organizationId: ORGANIZATION_A, userId: CALLER_ID });
const listedIds = async (): Promise<string[]> => {
  const list = await getTimeCorrectionRequests(ORGANIZATION_A);
  assert.ok(list.success, JSON.stringify(list));
  return list.requests.map((request) => request.id);
};

for (const role of ['employee', 'admin'] as const) {
  signInAs(world, role);
  assert.deepEqual(
    await summary(),
    {
      success: true,
      count: 1,
      submissionCount: 0,
      beforeMinutes: 0,
      proposedMinutes: 240,
      days: ['2026-03-04'],
    },
    `the ${role}'s „Vorgemerkte Zeit“ counts no request of the removed record`,
  );
  assert.deepEqual(
    await listedIds(),
    [currentRequest],
    `the ${role}'s request cards show no request of the removed record`,
  );
}

// Without a record the person holds now, no request shows.
world.tables.employee_records = [record(removedRecord, null)];
for (const role of ['employee', 'admin'] as const) {
  signInAs(world, role);
  assert.deepEqual(
    await summary(),
    { success: true, count: 0, submissionCount: 0, beforeMinutes: 0, proposedMinutes: 0, days: [] },
    `the ${role}'s „Vorgemerkte Zeit“ counts no request of a person without a record`,
  );
  assert.deepEqual(
    await listedIds(),
    [],
    `the ${role}'s request cards show no request of a person without a record`,
  );
}

// A foreign organization stays refused.
const notAMember = { success: false, error: 'not_a_member' };
assert.deepEqual(await getTimeCorrectionRequests(ORGANIZATION_B), notAMember);
assert.deepEqual(
  await getProvisionalTimeSummary({ organizationId: ORGANIZATION_B, userId: CALLER_ID }),
  notAMember,
);
