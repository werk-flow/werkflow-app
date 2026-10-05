// Actual Parkplatz actions over the in-memory database: input validation runs
// before identity, only managers pass, and every read and write stays inside
// the caller's organization.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const parkedJobId = '40000000-0000-4000-8000-000000000001';
const foreignJobId = '40000000-0000-4000-8000-000000000002';
const unparkedJobId = '40000000-0000-4000-8000-000000000003';
const managerRecordId = '50000000-0000-4000-8000-000000000001';
const officeUserId = '30000000-0000-4000-8000-000000000002';
const foreignManagerId = '30000000-0000-4000-8000-000000000009';

const world = installActionWorld({
  work_blockers: [
    {
      id: 'blocker-a',
      organization_id: ORGANIZATION_A,
      job_id: parkedJobId,
      kind: 'parking',
      state: 'open',
      version: 3,
      reason: 'material',
      details: 'Kessel fehlt',
      responsible_employee_record_id: managerRecordId,
      next_review_date: '2026-10-12',
      updated_at: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'blocker-b',
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      kind: 'parking',
      state: 'open',
      version: 1,
      reason: 'customer',
      details: null,
      responsible_employee_record_id: 'record-foreign',
      next_review_date: '2026-10-20',
      updated_at: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'blocker-resolved',
      organization_id: ORGANIZATION_A,
      job_id: unparkedJobId,
      kind: 'parking',
      state: 'resolved',
      version: 2,
      reason: 'other',
      details: null,
      responsible_employee_record_id: null,
      next_review_date: null,
      updated_at: '2026-09-01T08:00:00.000Z',
    },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'admin' },
    { organization_id: ORGANIZATION_A, user_id: officeUserId, role: 'buero' },
    { organization_id: ORGANIZATION_A, user_id: 'field-worker', role: 'employee' },
    { organization_id: ORGANIZATION_B, user_id: foreignManagerId, role: 'admin' },
  ],
  employee_records: [
    {
      id: managerRecordId,
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      first_name: 'Akte',
      last_name: 'Alt',
    },
    {
      id: 'record-office',
      organization_id: ORGANIZATION_A,
      user_id: officeUserId,
      first_name: null,
      last_name: null,
    },
    {
      id: 'record-foreign',
      organization_id: ORGANIZATION_B,
      user_id: foreignManagerId,
      first_name: 'Fremd',
      last_name: 'Firma',
    },
  ],
  profiles: [
    { id: CALLER_ID, first_name: 'Zoe', last_name: 'Admin' },
    { id: officeUserId, first_name: null, last_name: null },
    { id: foreignManagerId, first_name: 'Fremd', last_name: 'Firma' },
  ],
});
const { setJobParkingContext, getParkingResponsibleOptions, getJobParkingContexts } = await import(
  '@/lib/parking/actions'
);

const validInput = {
  jobId: parkedJobId,
  reason: 'customer',
  note: '  Kunde meldet sich  ',
  responsibleEmployeeRecordId: managerRecordId,
  nextReviewDate: '2026-11-03',
};

// Malformed input is refused before the caller is even identified.
world.callerId = null;
for (const invalid of [
  null,
  { ...validInput, jobId: 'not-a-uuid' },
  { ...validInput, reason: 'weather' },
  { ...validInput, note: 'x'.repeat(1001) },
  { ...validInput, responsibleEmployeeRecordId: '' },
  { ...validInput, nextReviewDate: '03.11.2026' },
  { ...validInput, nextReviewDate: '2026-02-30' },
]) {
  assert.deepEqual(await setJobParkingContext(invalid), { success: false, error: 'invalid_input' });
}

// Signed-out callers, callers without an organization and field workers are denied before any database access.
const denied = async (expectedError: string): Promise<void> => {
  assert.deepEqual(await setJobParkingContext(validInput), { success: false, error: expectedError });
  assert.deepEqual(await getParkingResponsibleOptions(), { success: false, error: expectedError });
  assert.deepEqual(await getJobParkingContexts(), { success: false, error: expectedError });
};
await denied('not_authenticated');
signInAs(world, null);
await denied('no_active_org');
signInAs(world, 'employee');
await denied('not_authorized');
assert.equal(world.adminClientRequests, 0);
assert.equal(world.rpcCalls.length, 0);

// A manager can only give context to an open parking blocker of the own organization.
signInAs(world, 'buero');
assert.deepEqual(await setJobParkingContext({ ...validInput, jobId: foreignJobId }), {
  success: false,
  error: 'job_not_parked',
});
assert.deepEqual(await setJobParkingContext({ ...validInput, jobId: unparkedJobId }), {
  success: false,
  error: 'job_not_parked',
});
assert.equal(world.rpcCalls.length, 0);

// The write names the caller's organization, the caller, and the version that was read; the note arrives trimmed.
assert.deepEqual(await setJobParkingContext(validInput), { success: true });
assert.equal(world.rpcCalls.length, 1);
const [write] = world.rpcCalls;
assert.ok(write);
assert.equal(write.name, 'upsert_work_blocker');
assert.deepEqual(
  [
    write.args.p_organization_id,
    write.args.p_actor_id,
    write.args.p_blocker_id,
    write.args.p_expected_version,
    write.args.p_job_id,
  ],
  [ORGANIZATION_A, CALLER_ID, 'blocker-a', 3, parkedJobId],
);
assert.deepEqual(
  [
    write.args.p_kind,
    write.args.p_reason,
    write.args.p_details,
    write.args.p_responsible_employee_record_id,
    write.args.p_next_review_date,
  ],
  ['parking', 'customer', 'Kunde meldet sich', managerRecordId, '2026-11-03'],
);

// Database refusals reach the caller as stable codes.
for (const [databaseMessage, expectedError] of [
  ['work_blocker_owner_invalid', 'responsible_not_manager'],
  ['work_blocker_stale_version', 'stale_version'],
  ['deadlock detected', 'update_failed'],
] as const) {
  world.rpc = () => ({ data: null, error: { code: 'P0001', message: databaseMessage } });
  assert.deepEqual(await setJobParkingContext(validInput), { success: false, error: expectedError });
}
world.rpc = () => ({ data: null, error: null });

// Responsible options are the own organization's admin and office records, sorted, with a label fallback.
assert.deepEqual(await getParkingResponsibleOptions(), {
  success: true,
  options: [
    { employeeRecordId: 'record-office', label: 'Unbenannt' },
    { employeeRecordId: managerRecordId, label: 'Zoe Admin' },
  ],
});

// Contexts list only the own organization's open parking blockers, with the responsible person's current name.
assert.deepEqual(await getJobParkingContexts(), {
  success: true,
  contexts: [
    {
      jobId: parkedJobId,
      blockerId: 'blocker-a',
      version: 3,
      reason: 'material',
      note: 'Kessel fehlt',
      responsibleEmployeeRecordId: managerRecordId,
      responsibleName: 'Zoe Admin',
      nextReviewDate: '2026-10-12',
      updatedAt: '2026-10-01T08:00:00.000Z',
    },
  ],
});

// A manager of the other organization sees that organization's context and nothing of this one.
signInAs(world, 'admin', ORGANIZATION_B);
const foreignContexts = await getJobParkingContexts();
assert.ok(foreignContexts.success);
assert.deepEqual(
  foreignContexts.contexts.map((context) => context.jobId),
  [foreignJobId],
);
