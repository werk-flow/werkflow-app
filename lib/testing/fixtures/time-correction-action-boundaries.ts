// Actual time-correction actions over the in-memory database: an organization
// id the caller is no member of is refused for every submission, list,
// history, form-option and summary read, a request of another organization is
// refused before any revision or decision is written, an employee reads no
// colleague's summary, and a withdrawal acts as the session user, so another
// person's request is refused by its one call. A refused call writes nothing.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const ownRecordId = '85000000-0000-4000-8000-000000000001';
const foreignRecordId = '85000000-0000-4000-8000-000000000002';
const colleagueId = '85000000-0000-4000-8000-000000000003';
const foreignUserId = '85000000-0000-4000-8000-000000000004';
const foreignRequestId = '85000000-0000-4000-8000-000000000005';
const unknownRequestId = '85000000-0000-4000-8000-000000000006';
const operationId = '85000000-0000-4000-8000-000000000007';

const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: foreignUserId },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_B, user_id: foreignUserId, role: 'employee' },
  ],
  time_correction_requests: [
    {
      id: foreignRequestId,
      organization_id: ORGANIZATION_B,
      subject_user_id: foreignUserId,
      requested_by: foreignUserId,
      source_scope_key: 'scope',
      current_revision: 1,
    },
  ],
});
// withdraw_time_correction refuses an actor who did not file the request
// (supabase/tests/p1_22_*.sql); here only that check.
world.rpc = ({ name, args }) => {
  assert.equal(name, 'withdraw_time_correction');
  const request = tableRows(world, 'time_correction_requests').find((row) => row.id === args.p_request_id);
  if (!request) return { data: null, error: { code: 'P0001', message: 'time_correction_not_found' } };
  if (request.requested_by !== args.p_actor_id)
    return { data: null, error: { code: 'P0001', message: 'time_correction_not_requester' } };
  return { data: null, error: { code: 'P0001', message: 'unexpected_withdrawal' } };
};
const {
  getProvisionalTimeCorrectionProjection,
  getProvisionalTimeSummary,
  getTimeCorrectionFormOptions,
  getTimeCorrectionHistoryPage,
  getTimeCorrectionRequests,
} = await import('@/lib/time-corrections/read-actions');
const {
  resubmitTimeCorrection,
  reviewTimeCorrectionsBatch,
  submitTimeCorrection,
  withdrawTimeCorrection,
} = await import('@/lib/time-corrections/actions');

const initialDatabase = databaseSnapshot(world);
const notAMember = { success: false, error: 'not_a_member' };
const submission = (organizationId: string, subjectEmployeeRecordId: string) =>
  submitTimeCorrection({
    organizationId,
    subjectEmployeeRecordId,
    kind: 'add',
    reason: 'Einstempeln vergessen',
    source: null,
    proposedFacts: [
      {
        factId: 'fact-1',
        employeeRecordId: subjectEmployeeRecordId,
        entryType: 'clock_in',
        timestamp: '2026-10-20T07:00:00+02:00',
      },
    ],
    operationId,
  });

signInAs(world, 'admin');
// An organization the caller is no member of is refused for every read and the submission.
assert.deepEqual(await submission(ORGANIZATION_B, foreignRecordId), notAMember);
assert.deepEqual(await getTimeCorrectionRequests(ORGANIZATION_B), notAMember);
assert.deepEqual(await getTimeCorrectionHistoryPage(ORGANIZATION_B, 1), notAMember);
assert.deepEqual(await getTimeCorrectionFormOptions(ORGANIZATION_B), notAMember);
assert.deepEqual(
  await getProvisionalTimeSummary({ organizationId: ORGANIZATION_B, userId: foreignUserId }),
  notAMember,
);
assert.deepEqual(
  await getProvisionalTimeCorrectionProjection({
    organizationId: ORGANIZATION_B,
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-31T23:59:59Z',
  }),
  { entries: [], sources: [] },
);

// Another organization's employee record is no subject in the caller's organization.
assert.deepEqual(await submission(ORGANIZATION_A, foreignRecordId), {
  success: false,
  error: 'subject_not_found',
});

// A request of another organization is refused before a revision or decision is written.
assert.deepEqual(
  await resubmitTimeCorrection({
    requestId: foreignRequestId,
    expectedRevision: 1,
    reason: 'Neu eingereicht',
    operationId,
  }),
  notAMember,
);
assert.deepEqual(
  await reviewTimeCorrectionsBatch({
    requests: [{ requestId: foreignRequestId, expectedRevision: 1 }],
    decision: 'approve',
    comment: null,
  }),
  notAMember,
);
assert.deepEqual(
  await reviewTimeCorrectionsBatch({
    requests: [{ requestId: unknownRequestId, expectedRevision: 1 }],
    decision: 'approve',
    comment: null,
  }),
  { success: false, error: 'request_not_found' },
);
assert.equal(world.rpcCalls.length, 0);

// A withdrawal names the session user, so another person's request is refused by its one call.
assert.deepEqual(await withdrawTimeCorrection({ requestId: foreignRequestId, operationId }), {
  success: false,
  error: 'time_correction_not_requester',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_actor_id]),
  [['withdraw_time_correction', CALLER_ID]],
);

// An employee reads no colleague's provisional summary.
signInAs(world, 'employee');
assert.deepEqual(await getProvisionalTimeSummary({ organizationId: ORGANIZATION_A, userId: colleagueId }), {
  success: false,
  error: 'not_authorized',
});
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
