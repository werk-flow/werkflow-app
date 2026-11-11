// The real access and employment transition actions over the in-memory
// database: a step that does not fit the person's current state is refused
// before the database function, as is a stale version, a failed state read,
// Büro, and an Admin's call for another organization's record. A step that
// fits reaches the function. lib/personnel/lifecycle-steps.test.ts owns the
// per-state rules; this proves the server holds to them.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

const memberRecordId = '84000000-0000-4000-8000-000000000001';
const noLoginRecordId = '84000000-0000-4000-8000-000000000002';
const activeRecordId = '84000000-0000-4000-8000-000000000003';
const exitedRecordId = '84000000-0000-4000-8000-000000000004';
const foreignRecordId = '84000000-0000-4000-8000-000000000005';
const heldRecordId = '84000000-0000-4000-8000-000000000006';
const heldUserId = '84000000-0000-4000-8000-000000000016';
const recordedAccessOperationId = '84000000-0000-4000-8000-000000000022';
const recordedEmploymentOperationId = '84000000-0000-4000-8000-000000000023';
const memberUserId = '84000000-0000-4000-8000-000000000011';
const activeUserId = '84000000-0000-4000-8000-000000000012';
const foreignUserId = '84000000-0000-4000-8000-000000000015';
const operationId = '84000000-0000-4000-8000-000000000021';
const lifecycleId = '84000000-0000-4000-8000-000000000031';
const now = '2026-11-10T09:00:00.000Z';

const record = (
  id: string,
  organizationId: string,
  userId: string | null,
  exitDate: string | null = null,
) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
  entry_date: '2024-01-01',
  exit_date: exitDate,
});
const member = (organizationId: string, userId: string) => ({
  organization_id: organizationId,
  user_id: userId,
  role: 'employee',
});
const lifecycle = (employeeRecordId: string, state: string, version: number) => ({
  id: `${employeeRecordId.slice(0, -2)}99`,
  organization_id: ORGANIZATION_A,
  employee_record_id: employeeRecordId,
  state,
  scheduled_state: null,
  scheduled_for: null,
  version,
});

const world = installActionWorld({
  employee_records: [
    record(memberRecordId, ORGANIZATION_A, memberUserId),
    record(noLoginRecordId, ORGANIZATION_A, null),
    record(activeRecordId, ORGANIZATION_A, activeUserId),
    record(exitedRecordId, ORGANIZATION_A, null, '2026-10-31'),
    record(foreignRecordId, ORGANIZATION_B, foreignUserId),
    record(heldRecordId, ORGANIZATION_A, heldUserId),
  ],
  organization_members: [
    member(ORGANIZATION_A, memberUserId),
    member(ORGANIZATION_A, activeUserId),
    member(ORGANIZATION_A, heldUserId),
    member(ORGANIZATION_B, foreignUserId),
  ],
  personnel_access_lifecycles: [
    lifecycle(activeRecordId, 'active', 2),
    // A due activation an open blocking requirement holds back.
    {
      ...lifecycle(heldRecordId, 'scheduled', 1),
      scheduled_state: 'active',
      scheduled_for: '2026-01-05T07:00:00.000Z',
    },
  ],
  personnel_employment_lifecycles: [lifecycle(exitedRecordId, 'exited', 4)],
  // Two transitions that already succeeded: their retries must reach the function's replay check.
  personnel_lifecycle_operations: [
    { organization_id: ORGANIZATION_A, operation_id: recordedAccessOperationId, request_hash: 'stored' },
    { organization_id: ORGANIZATION_A, operation_id: recordedEmploymentOperationId, request_hash: 'stored' },
  ],
  personnel_onboarding_requirements: [
    {
      id: '84000000-0000-4000-8000-000000000041',
      organization_id: ORGANIZATION_A,
      employee_record_id: heldRecordId,
      blocks_access: true,
      state: 'missing',
    },
  ],
});
world.rpc = ({ name }) =>
  name === 'set_personnel_access_transition' || name === 'set_personnel_employment_transition'
    ? { data: lifecycleId, error: null }
    : { data: [], error: null };

const { setPersonnelAccessTransition, setPersonnelEmploymentTransition } = await import(
  '@/lib/personnel/lifecycle-actions'
);

const access = (employeeRecordId: string, transitionKind: string, expectedVersion = 0) =>
  setPersonnelAccessTransition({
    employeeRecordId,
    expectedVersion,
    transitionKind,
    effectiveAt: now,
    reason: 'Schritt erfassen',
    operationId,
  });
const employment = (employeeRecordId: string, transitionKind: string, expectedVersion = 0) =>
  setPersonnelEmploymentTransition({
    employeeRecordId,
    expectedVersion,
    transitionKind,
    effectiveOn: '2026-11-10',
    reason: 'Schritt erfassen',
    operationId,
  });
const notAllowed = { success: false, error: 'transition_not_allowed' };
const transitionCalls = () =>
  world.rpcCalls.filter((call) => call.name.startsWith('set_personnel_')).map((call) => call.name);

signInAs(world, 'admin');

// Access steps that do not fit are refused before the database function.
assert.deepEqual(
  await access(memberRecordId, 'reactivate'),
  notAllowed,
  'a member who has access is not reactivated',
);
assert.deepEqual(await access(memberRecordId, 'cancel_scheduled'), notAllowed, 'nothing planned to withdraw');
assert.deepEqual(
  await access(noLoginRecordId, 'activate_now'),
  notAllowed,
  'no login, no immediate activation',
);
assert.deepEqual(
  await access(activeRecordId, 'activate_now', 2),
  notAllowed,
  'active access is not activated again',
);
assert.deepEqual(await access(activeRecordId, 'schedule_activation', 2), notAllowed);
assert.deepEqual(
  await access(heldRecordId, 'schedule_activation', 1),
  notAllowed,
  'a held activation is not planned again, which would open access at once',
);
// Employment steps that do not fit are refused too.
assert.deepEqual(
  await employment(exitedRecordId, 'record_notice', 4),
  notAllowed,
  'an exited person gets no notice',
);
assert.deepEqual(
  await employment(exitedRecordId, 'exit', 4),
  notAllowed,
  'an exited person does not exit again',
);
assert.deepEqual(
  await employment(memberRecordId, 'start'),
  notAllowed,
  'an active person does not start again',
);
assert.deepEqual(
  await employment(memberRecordId, 'reverse'),
  notAllowed,
  'nothing to reverse for an active person',
);
assert.deepEqual(transitionCalls(), [], 'a refused step reaches no database function');

// A version the caller did not see is stale, and a failed state read refuses the step.
assert.deepEqual(await access(activeRecordId, 'suspend_now', 1), { success: false, error: 'stale_version' });
assert.deepEqual(await employment(exitedRecordId, 'reactivate', 3), {
  success: false,
  error: 'stale_version',
});
world.failingTables.add('personnel_access_lifecycles');
assert.deepEqual(await access(activeRecordId, 'suspend_now', 2), { success: false, error: 'load_failed' });
world.failingTables.delete('personnel_access_lifecycles');
world.failingTables.add('organization_members');
assert.deepEqual(await access(memberRecordId, 'suspend_now'), { success: false, error: 'load_failed' });
world.failingTables.delete('organization_members');
assert.deepEqual(transitionCalls(), []);

// An Admin reaches no record of another organization, whatever the step.
const recordNotFound = { success: false, error: 'record_not_found' };
assert.deepEqual(await access(foreignRecordId, 'suspend_now'), recordNotFound);
assert.deepEqual(await employment(foreignRecordId, 'record_notice'), recordNotFound);
// Büro changes neither, even with a step that fits.
signInAs(world, 'buero');
assert.deepEqual(await access(memberRecordId, 'suspend_now'), { success: false, error: 'not_authorized' });
assert.deepEqual(await employment(memberRecordId, 'record_notice'), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(transitionCalls(), []);

// Steps that fit reach the database function with the caller's organization.
signInAs(world, 'admin');
assert.deepEqual(await access(memberRecordId, 'suspend_now'), { success: true, data: { lifecycleId } });
assert.deepEqual(await access(memberRecordId, 'activate_now'), { success: true, data: { lifecycleId } });
assert.deepEqual(await access(noLoginRecordId, 'schedule_activation'), {
  success: true,
  data: { lifecycleId },
});
assert.deepEqual(await access(activeRecordId, 'end_access', 2), { success: true, data: { lifecycleId } });
assert.deepEqual(await access(heldRecordId, 'cancel_scheduled', 1), { success: true, data: { lifecycleId } });
assert.deepEqual(await employment(exitedRecordId, 'reactivate', 4), { success: true, data: { lifecycleId } });
assert.deepEqual(await employment(memberRecordId, 'record_notice'), { success: true, data: { lifecycleId } });
// A retry of a recorded transition reaches the function's replay check, which answers with the
// stored result or refuses a changed request, although the state has moved on since: the old
// version and a step that no longer fits are not refused here.
assert.deepEqual(
  await setPersonnelAccessTransition({
    employeeRecordId: activeRecordId,
    expectedVersion: 1,
    transitionKind: 'activate_now',
    effectiveAt: now,
    reason: 'Schritt erfassen',
    operationId: recordedAccessOperationId,
  }),
  { success: true, data: { lifecycleId } },
);
assert.deepEqual(
  await setPersonnelEmploymentTransition({
    employeeRecordId: exitedRecordId,
    expectedVersion: 3,
    transitionKind: 'exit',
    effectiveOn: '2026-10-31',
    reason: 'Schritt erfassen',
    operationId: recordedEmploymentOperationId,
  }),
  { success: true, data: { lifecycleId } },
);
assert.deepEqual(transitionCalls(), [
  'set_personnel_access_transition',
  'set_personnel_access_transition',
  'set_personnel_access_transition',
  'set_personnel_access_transition',
  'set_personnel_access_transition',
  'set_personnel_employment_transition',
  'set_personnel_employment_transition',
  'set_personnel_access_transition',
  'set_personnel_employment_transition',
]);
for (const call of world.rpcCalls.filter((entry) => entry.name.startsWith('set_personnel_'))) {
  assert.equal(call.args.p_organization_id, ORGANIZATION_A);
}
