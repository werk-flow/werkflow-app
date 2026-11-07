// Actual time-correction actions over the in-memory database: an organization
// id the caller is no member of is refused for every submission, list,
// history, form-option and summary read, a request of another organization is
// refused before any revision or decision is written, an employee reads no
// colleague's summary, and a withdrawal acts as the session user, so another
// person's request is refused by its one call. A proposed fact names only the
// request's subject, except in a reassignment, which only Admin and Büro
// submit: a fact for a coworker or for another organization's record, and an
// employee's reassignment, are refused before any time of that person is read.
// A refused call writes nothing.
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
const coworkerRecordId = '85000000-0000-4000-8000-000000000008';
const ownEntryId = '85000000-0000-4000-8000-000000000009';
const ownReassignRequestId = '85000000-0000-4000-8000-000000000010';
const legacyEditRequestId = '85000000-0000-4000-8000-000000000011';

const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: foreignUserId },
    { id: coworkerRecordId, organization_id: ORGANIZATION_A, user_id: colleagueId },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: colleagueId, role: 'employee' },
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
    // The caller's own reassignment, returned with a question.
    {
      id: ownReassignRequestId,
      organization_id: ORGANIZATION_A,
      subject_user_id: CALLER_ID,
      requested_by: CALLER_ID,
      kind: 'reassign',
      status: 'clarification_required',
      source_scope_key: 'own-scope',
      current_revision: 1,
    },
    // An edit stored before the subject rule, whose proposal names a coworker.
    {
      id: legacyEditRequestId,
      organization_id: ORGANIZATION_A,
      subject_user_id: CALLER_ID,
      requested_by: CALLER_ID,
      kind: 'edit',
      status: 'clarification_required',
      source_scope_key: 'legacy-scope',
      current_revision: 1,
    },
  ],
  time_correction_request_revisions: [
    {
      organization_id: ORGANIZATION_A,
      request_id: legacyEditRequestId,
      revision: 1,
      source_fingerprint: 'legacy',
      before_snapshot: { schemaVersion: 1, facts: [] },
      proposed_snapshot: {
        schemaVersion: 1,
        facts: [
          {
            factId: 'legacy',
            employeeRecordId: coworkerRecordId,
            userId: colleagueId,
            entryType: 'clock_out',
            timestamp: '2026-10-20T14:00:00.000Z',
            jobId: null,
            activityKind: null,
            isManual: true,
          },
        ],
      },
    },
  ],
  time_correction_request_sources: [],
  time_entries: [
    {
      id: ownEntryId,
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      entry_type: 'clock_in',
      timestamp: '2026-10-20T05:00:00.000Z',
      job_id: null,
      is_manual: false,
      status: 'approved',
      created_at: '2026-10-20T05:00:00.000Z',
      updated_at: '2026-10-20T05:00:00.000Z',
    },
  ],
});
// The tables every action call reads or writes, to prove what a refusal never reached.
const touchedTables = new Set<string>();
const tables = world.tables;
world.tables = new Proxy(tables, {
  get: (target, table) => {
    if (typeof table === 'string') touchedTables.add(table);
    return Reflect.get(target, table);
  },
});
// withdraw_time_correction refuses an actor who did not file the request
// (supabase/tests/p1_22_*.sql); here only that check.
world.rpc = ({ name, args }) => {
  if (name === 'create_time_correction_request')
    return { data: null, error: { code: 'P0001', message: 'unexpected_submission' } };
  assert.equal(name, 'withdraw_time_correction');
  const request = tableRows(world, 'time_correction_requests').find((row) => row.id === args.p_request_id);
  if (!request) return { data: null, error: { code: 'P0001', message: 'time_correction_not_found' } };
  if (request.requested_by !== args.p_actor_id)
    return { data: null, error: { code: 'P0001', message: 'time_correction_not_requester' } };
  return { data: null, error: { code: 'P0001', message: 'unexpected_withdrawal' } };
};
const {
  getProvisionalTimeSummary,
  getTimeCorrectionFormOptions,
  getTimeCorrectionHistoryPage,
  getTimeCorrectionRequests,
} = await import('@/lib/time-corrections/read-actions');
const {
  getProvisionalTimeCorrectionProjection,
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

// Every kind but a reassignment proposes facts of its subject only. A fact
// for a coworker, or for another organization's record, is refused before
// any time is read, so the refusal reveals nothing about that person's day.
const ownFact = (factId: string, entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
  factId,
  employeeRecordId: ownRecordId,
  entryType,
  timestamp,
});
const ownSource = { kind: 'legacy_entry' as const, id: ownEntryId };
for (const namedRecordId of [coworkerRecordId, foreignRecordId]) {
  const named = {
    ...ownFact('named', 'clock_out', '2026-10-20T16:00:00+02:00'),
    employeeRecordId: namedRecordId,
  };
  const proposals = [
    {
      kind: 'add' as const,
      source: null,
      proposedFacts: [ownFact('start', 'clock_in', '2026-10-20T07:00:00+02:00'), named],
    },
    {
      kind: 'missed_clock' as const,
      source: null,
      proposedFacts: [ownFact('start', 'clock_in', '2026-10-20T07:00:00+02:00'), named],
    },
    { kind: 'edit' as const, source: ownSource, proposedFacts: [named] },
    { kind: 'reclassify' as const, source: ownSource, proposedFacts: [named] },
    { kind: 'reallocate' as const, source: ownSource, proposedFacts: [named] },
    {
      kind: 'split' as const,
      source: ownSource,
      proposedFacts: [
        ownFact('first-start', 'clock_in', '2026-10-20T07:00:00+02:00'),
        ownFact('first-end', 'clock_out', '2026-10-20T12:00:00+02:00'),
        ownFact('second-start', 'clock_in', '2026-10-20T12:00:00+02:00'),
        named,
      ],
    },
    // A deletion proposes no fact, so it cannot name anyone.
  ];
  for (const proposal of proposals) {
    touchedTables.clear();
    assert.deepEqual(
      await submitTimeCorrection({
        organizationId: ORGANIZATION_A,
        subjectEmployeeRecordId: ownRecordId,
        reason: 'Zeit korrigieren',
        operationId,
        ...proposal,
      }),
      { success: false, error: 'invalid_shape' },
      `${proposal.kind} naming ${namedRecordId === coworkerRecordId ? 'a coworker' : 'a foreign record'}`,
    );
    assert.deepEqual(
      [...touchedTables].filter((table) => table.startsWith('time_')),
      [],
      `${proposal.kind} reads no time before its refusal`,
    );
  }
}
// Only Admin and Büro move time to another person. An employee's
// reassignment is refused before any time is read.
touchedTables.clear();
assert.deepEqual(
  await submitTimeCorrection({
    organizationId: ORGANIZATION_A,
    subjectEmployeeRecordId: ownRecordId,
    reason: 'Falsch gestempelt',
    operationId,
    kind: 'reassign',
    source: ownSource,
    proposedFacts: [
      { ...ownFact('moved', 'clock_in', '2026-10-20T07:00:00+02:00'), employeeRecordId: coworkerRecordId },
    ],
  }),
  { success: false, error: 'not_authorized' },
  'an employee reassignment',
);
assert.deepEqual(
  [...touchedTables].filter((table) => table.startsWith('time_')),
  [],
  'an employee reassignment reads no time before its refusal',
);
// A stored proposal that names someone other than its subject is never
// carried forward by a resubmission.
assert.deepEqual(
  await resubmitTimeCorrection({
    requestId: legacyEditRequestId,
    expectedRevision: 1,
    reason: 'Neu eingereicht',
    operationId,
  }),
  { success: false, error: 'invalid_shape' },
  'a stored proposal naming a coworker is resubmitted',
);

// Nor does an employee resubmit an earlier reassignment: the refusal comes
// before any revision or source is read.
touchedTables.clear();
assert.deepEqual(
  await resubmitTimeCorrection({
    requestId: ownReassignRequestId,
    expectedRevision: 1,
    reason: 'Neu eingereicht',
    operationId,
  }),
  { success: false, error: 'not_authorized' },
  'an employee resubmits a reassignment',
);
assert.deepEqual(
  [...touchedTables].filter((table) => table.startsWith('time_correction_request_')),
  [],
  'a refused resubmission reads no revision',
);
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['withdraw_time_correction'],
  'no refused correction is written',
);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
