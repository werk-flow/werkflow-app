// The real handover action over the in-memory database: a field worker hands
// over nobody's work, and the office of organization A reaches no person, no
// target and no job of organization B. A person outside the organization, the
// leaver themselves and a past date are refused before the write function;
// a foreign job reaches the function only inside the caller's organization,
// which refuses it. A refused call changes no row.
import assert from 'node:assert/strict';
import { setSystemTime } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

// Mon 09.11.2026, 10:00 Berlin.
setSystemTime(new Date('2026-11-09T09:00:00.000Z'));

const leaverRecordId = '87000000-0000-4000-8000-000000000001';
const targetRecordId = '87000000-0000-4000-8000-000000000002';
const foreignRecordId = '87000000-0000-4000-8000-000000000003';
const parkedJobId = '87000000-0000-4000-8000-000000000011';
const foreignJobId = '87000000-0000-4000-8000-000000000012';

const world = installActionWorld({
  employee_records: [
    { id: leaverRecordId, organization_id: ORGANIZATION_A, user_id: '87000000-0000-4000-8000-000000000021' },
    { id: targetRecordId, organization_id: ORGANIZATION_A, user_id: '87000000-0000-4000-8000-000000000022' },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: '87000000-0000-4000-8000-000000000023' },
  ],
  jobs: [
    { id: parkedJobId, organization_id: ORGANIZATION_A, status: 'geparkt' },
    { id: foreignJobId, organization_id: ORGANIZATION_B, status: 'nicht_bearbeitet' },
  ],
  planning_occurrences: [],
});
// The handover function refuses a job outside the organization it is given
// (supabase/tests/job_plan_bridge.sql); here only that lookup.
world.rpc = ({ name, args }) => {
  if (name !== 'hand_over_personnel_work') {
    return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
  }
  const rows = Array.isArray(args.p_rows) ? args.p_rows : [];
  const inOrganization = rows.every((row: unknown) =>
    tableRows(world, 'jobs').some(
      (job) =>
        typeof row === 'object' &&
        row !== null &&
        'jobId' in row &&
        job.id === row.jobId &&
        job.organization_id === args.p_organization_id,
    ),
  );
  return inOrganization
    ? { data: rows.length, error: null }
    : { data: null, error: { code: 'P0001', message: 'job_not_found' } };
};

const { handOverPersonnelWork } = await import('@/lib/personnel/handover-actions');

const handOver = (input: { leaver?: string; target?: string; jobId?: string; from?: string }) =>
  handOverPersonnelWork({
    employeeRecordId: input.leaver ?? leaverRecordId,
    handoverFrom: input.from ?? '2026-12-01',
    rows: [{ jobId: input.jobId ?? parkedJobId, targetEmployeeRecordId: input.target ?? targetRecordId }],
  });
const initialDatabase = databaseSnapshot(world);

// A field worker plans nothing: refused before any service-role client.
signInAs(world, 'employee');
assert.deepEqual(await handOver({}), { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, 0, 'a field worker reaches no service-role client');

for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  world.rpcCalls.length = 0;
  // Another organization's person, a target outside the organization and the leaver as their own target.
  assert.deepEqual(await handOver({ leaver: foreignRecordId }), {
    success: false,
    error: 'record_not_found',
  });
  assert.deepEqual(await handOver({ target: foreignRecordId }), {
    success: false,
    error: 'target_not_found',
  });
  assert.deepEqual(await handOver({ target: leaverRecordId }), { success: false, error: 'invalid_target' });
  assert.deepEqual(await handOver({ from: '2026-11-08' }), {
    success: false,
    error: 'invalid_handover_date',
  });
  assert.equal(world.rpcCalls.length, 0, `${role}: a refused handover reached the write function`);

  // A foreign job reaches the write function only in the caller's organization, which refuses it.
  assert.deepEqual(await handOver({ jobId: foreignJobId }), { success: false, error: 'job_not_found' });
  assert.deepEqual(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);
  assert.deepEqual(world.rpcCalls.at(-1)?.args.p_actor_id, CALLER_ID);
  assert.equal(databaseSnapshot(world), initialDatabase, `${role}: a refused handover changed a row`);

  // The caller's own parked job, without a visit to assess, goes to the target.
  assert.deepEqual(await handOver({}), { success: true, data: { handedOver: 1 } });
  assert.deepEqual(world.rpcCalls.at(-1)?.args.p_assessments, []);
}
