// Actual personnel record actions over the in-memory database: an employee
// reads and writes no personnel data and is refused before the database, and
// a manager of organization A reaches no record, condition or schedule of
// organization B. Each write is one function call that names the caller's
// organization, so the function's org-scoped lock refuses the foreign id.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import {
  assertCallerScopedCalls,
  databaseSnapshot,
  installScopedFunctions,
} from './workforce-boundary-support';

const ownRecordId = '81000000-0000-4000-8000-000000000001';
const foreignRecordId = '81000000-0000-4000-8000-000000000002';
const foreignUserId = '81000000-0000-4000-8000-000000000003';
const ownConditionId = '81000000-0000-4000-8000-000000000004';
const foreignConditionId = '81000000-0000-4000-8000-000000000005';
const ownScheduleId = '81000000-0000-4000-8000-000000000006';
const foreignScheduleId = '81000000-0000-4000-8000-000000000007';

const scoped = (id: string, organizationId: string, employeeRecordId: string) => ({
  id,
  organization_id: organizationId,
  employee_record_id: employeeRecordId,
});
const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: null, last_name: 'Eigen' },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: foreignUserId, last_name: 'Fremd' },
  ],
  employment_conditions: [
    scoped(ownConditionId, ORGANIZATION_A, ownRecordId),
    scoped(foreignConditionId, ORGANIZATION_B, foreignRecordId),
  ],
  work_schedules: [
    scoped(ownScheduleId, ORGANIZATION_A, ownRecordId),
    scoped(foreignScheduleId, ORGANIZATION_B, foreignRecordId),
  ],
});
const recordScope = { table: 'employee_records', idArgument: 'p_record_id', refusal: 'record_not_found' };
const conditionScope = {
  table: 'employment_conditions',
  idArgument: 'p_condition_id',
  refusal: 'condition_not_found',
};
const scheduleScope = { table: 'work_schedules', idArgument: 'p_schedule_id', refusal: 'schedule_not_found' };
installScopedFunctions(world, {
  update_employee_master_data: recordScope,
  add_employment_condition: recordScope,
  add_work_schedule: recordScope,
  update_employment_condition: conditionScope,
  delete_employment_condition: conditionScope,
  update_work_schedule: scheduleScope,
  delete_work_schedule: scheduleScope,
});
const {
  addEmploymentCondition,
  addWorkSchedule,
  createPersonnelRecord,
  deleteEmploymentCondition,
  deleteWorkSchedule,
  getPersonnelDetail,
  updateEmploymentCondition,
  updatePersonnelMasterData,
  updateWorkSchedule,
} = await import('@/lib/personnel/actions');
const { getPersonnelRecords, suggestPersonnelNumber } = await import('@/lib/personnel/record-read-actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const condition = { validFrom: '2026-11-01', employmentType: 'vollzeit' as const, weeklyHours: 40 };
const schedule = { validFrom: '2026-11-01', dayMinutes: [480, 480, 480, 480, 480, 0, 0] };
const calls = (recordId: string, conditionId: string, scheduleId: string) =>
  [
    () => updatePersonnelMasterData(recordId, { phone: '0711 123456' }),
    () => addEmploymentCondition(recordId, condition),
    () => updateEmploymentCondition(conditionId, condition),
    () => deleteEmploymentCondition(conditionId),
    () => addWorkSchedule(recordId, schedule),
    () => updateWorkSchedule(scheduleId, schedule),
    () => deleteWorkSchedule(scheduleId),
  ] as const;

// An employee reads no personnel list, detail or number and writes nothing, before any database access.
signInAs(world, 'employee');
assert.deepEqual(await getPersonnelRecords(), notAuthorized);
assert.deepEqual(await getPersonnelDetail(ownRecordId), notAuthorized);
assert.deepEqual(await suggestPersonnelNumber(), notAuthorized);
assert.deepEqual(await createPersonnelRecord({ lastName: 'Neu' }), notAuthorized);
for (const call of calls(ownRecordId, ownConditionId, ownScheduleId)) {
  assert.deepEqual(await call(), notAuthorized);
}
assert.equal(world.adminClientRequests, 0);
assert.equal(world.rpcCalls.length, 0);

// A Büro manager of organization A finds no record of organization B, by record or by user id.
signInAs(world, 'buero');
assert.deepEqual(await getPersonnelDetail(foreignRecordId), { success: false, error: 'record_not_found' });
assert.deepEqual(await getPersonnelDetail(foreignUserId), { success: false, error: 'record_not_found' });

// Each write of a foreign record, condition or schedule is refused by its one call, and nothing changes.
const expected = [
  'record_not_found',
  'record_not_found',
  'condition_not_found',
  'condition_not_found',
  'record_not_found',
  'schedule_not_found',
  'schedule_not_found',
];
const foreignCalls = calls(foreignRecordId, foreignConditionId, foreignScheduleId);
for (const [index, call] of foreignCalls.entries()) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await call(), { success: false, error: expected[index] });
  assert.equal(world.rpcCalls.length, 1, `${expected[index]}: a refused write made a second call`);
  assertCallerScopedCalls(world);
}
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');

// The same calls on the caller's own rows reach the function and succeed.
world.rpcCalls.length = 0;
for (const call of calls(ownRecordId, ownConditionId, ownScheduleId)) {
  assert.deepEqual(await call(), { success: true });
}
assert.equal(world.rpcCalls.length, 7);
assertCallerScopedCalls(world);
