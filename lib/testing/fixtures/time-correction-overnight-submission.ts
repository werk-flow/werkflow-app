// The actual submitTimeCorrection over the in-memory database: a forgotten
// overnight shift from 22:00 to 01:30 goes in as one request whose proposal
// closes and reopens at Berlin midnight, and recorded time after midnight
// still refuses it as an overlap before any request is written. A lone
// clock-out after midnight that closes the evening's recorded clock-in is
// refused with the midnight rule, never as an overlap. Open time over 24
// hours is refused before the midnight split runs, so a span of years builds
// no facts. Only legacy
// entries are recorded here, so canonical segments and approved corrections read empty.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const ownRecordId = '86000000-0000-4000-8000-000000000001';
const firstOperationId = '86000000-0000-4000-8000-000000000002';
const secondOperationId = '86000000-0000-4000-8000-000000000003';
const thirdOperationId = '86000000-0000-4000-8000-000000000004';
const fourthOperationId = '86000000-0000-4000-8000-000000000005';
const fifthOperationId = '86000000-0000-4000-8000-000000000006';

const world = installActionWorld({
  employee_records: [{ id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' }],
  time_entries: [],
});
mock.module('@/lib/time-tracking/canonical-entries', () => ({
  getCanonicalTimeEntries: async () => ({ success: true, entries: [] }),
}));
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [],
}));
// Counts the midnight splits; the real split is captured first, because the
// mock replaces the module's live bindings.
const timelineValidation = { ...(await import('@/lib/time-corrections/timeline-validation')) };
const split = timelineValidation.splitCorrectionFactsAtMidnight;
let splits = 0;
mock.module('@/lib/time-corrections/timeline-validation', () => ({
  ...timelineValidation,
  splitCorrectionFactsAtMidnight: (...args: Parameters<typeof split>) => {
    splits += 1;
    return split(...args);
  },
}));
world.rpc = ({ name }) => {
  assert.equal(name, 'create_time_correction_request');
  return { data: { requestId: 'request', status: 'submitted', replayed: false }, error: null };
};
const { submitTimeCorrection } = await import('@/lib/time-corrections/actions');

const shift = (operationId: string, start: string, end: string) =>
  submitTimeCorrection({
    organizationId: ORGANIZATION_A,
    subjectEmployeeRecordId: ownRecordId,
    kind: 'missed_clock',
    reason: 'Notdienst, Ausstempeln vergessen',
    source: null,
    proposedFacts: [
      {
        factId: 'start',
        employeeRecordId: ownRecordId,
        entryType: 'clock_in',
        timestamp: start,
      },
      {
        factId: 'end',
        employeeRecordId: ownRecordId,
        entryType: 'clock_out',
        timestamp: end,
      },
    ],
    operationId,
  });
const overnightShift = (operationId: string) =>
  shift(operationId, '2026-10-20T22:00:00+02:00', '2026-10-21T01:30:00+02:00');

signInAs(world, 'employee');
assert.deepEqual(await overnightShift(firstOperationId), {
  success: true,
  requestId: 'request',
  status: 'submitted',
  replayed: false,
});
const [created] = world.rpcCalls;
assert.ok(created, 'the request is written');
const proposed = created.args.p_proposed_snapshot;
assert.ok(proposed && typeof proposed === 'object' && 'facts' in proposed && Array.isArray(proposed.facts));
assert.deepEqual(
  proposed.facts.map((fact: { entryType: string; timestamp: string }) => [fact.entryType, fact.timestamp]),
  [
    ['clock_in', '2026-10-20T20:00:00.000Z'],
    ['clock_out', '2026-10-20T22:00:00.000Z'],
    ['clock_in', '2026-10-20T22:00:00.000Z'],
    ['clock_out', '2026-10-20T23:30:00.000Z'],
  ],
);

function recordEntries(entries: ReadonlyArray<readonly [string, string]>): void {
  world.tables.time_entries = entries.map(([entryType, timestamp], index) => ({
    id: `86000000-0000-4000-8000-00000000001${index}`,
    organization_id: ORGANIZATION_A,
    user_id: CALLER_ID,
    entry_type: entryType,
    timestamp,
    is_manual: false,
    job_id: null,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }));
}

// Recorded time after midnight is a real overlap: refused before any request is written.
recordEntries([
  ['clock_in', '2026-10-20T22:30:00.000Z'],
  ['clock_out', '2026-10-20T23:00:00.000Z'],
]);
assert.deepEqual(await overnightShift(secondOperationId), {
  success: false,
  error: 'correction_timeline_conflict',
});

// Only the end after midnight, closing the clock-in recorded at 22:00 the evening before.
recordEntries([['clock_in', '2026-10-20T20:00:00.000Z']]);
assert.deepEqual(
  await submitTimeCorrection({
    organizationId: ORGANIZATION_A,
    subjectEmployeeRecordId: ownRecordId,
    kind: 'missed_clock',
    reason: 'Ausstempeln vergessen',
    source: null,
    proposedFacts: [
      {
        factId: 'end',
        employeeRecordId: ownRecordId,
        entryType: 'clock_out',
        timestamp: '2026-10-21T01:30:00+02:00',
      },
    ],
    operationId: thirdOperationId,
  }),
  { success: false, error: 'correction_crosses_midnight' },
);

// Open time over 24 hours is refused before the split: one minute over, or years.
recordEntries([]);
const splitsBefore = splits;
for (const [operationId, start] of [
  [fourthOperationId, '2026-10-20T01:29:00+02:00'],
  [fifthOperationId, '2020-01-01T08:00:00+01:00'],
] as const) {
  assert.deepEqual(await shift(operationId, start, '2026-10-21T01:30:00+02:00'), {
    success: false,
    error: 'correction_open_time_too_long',
  });
}
assert.equal(splits, splitsBefore, 'refused open time is never split');
assert.ok(splitsBefore > 0, 'the accepted shift ran through the split');
assert.equal(world.rpcCalls.length, 1, 'a refused overnight correction writes nothing');
