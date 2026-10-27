// The actual account deletion action over the in-memory database: any
// membership row refuses it, also a suspended or an ended one that the
// operational membership read no longer returns. The action never deletes the
// profile itself; the Auth deletion's cascade removes it, so a refused Auth
// deletion leaves the profile in place.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, tableRows } from './action-boundary-world';

const employeeRecordId = '40000000-0000-4000-8000-000000000001';
const callerProfile = { id: CALLER_ID, first_name: 'Former', last_name: 'Employee' };
const membership = { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' };
const colleagueMembership = {
  organization_id: ORGANIZATION_A,
  user_id: '30000000-0000-4000-8000-000000000002',
  role: 'employee',
};

const world = installActionWorld({ profiles: [callerProfile] });
const { deleteAccount } = await import('@/lib/auth/actions');

const profileKept = (): boolean => tableRows(world, 'profiles').some((row) => row.id === CALLER_ID);

// A signed-out caller reaches neither the database nor Auth.
world.callerId = null;
assert.deepEqual(await deleteAccount(), { success: false, error: 'not_authenticated' });
assert.equal(world.adminClientRequests, 0);
world.callerId = CALLER_ID;

// Suspension and access end keep the membership row; the operational
// membership read (world.memberships) is empty for both.
for (const state of ['suspended', 'ended'] as const) {
  world.memberships = [];
  world.tables.organization_members = [membership];
  world.tables.employee_records = [
    { id: employeeRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
  ];
  world.tables.personnel_access_lifecycles = [
    { organization_id: ORGANIZATION_A, employee_record_id: employeeRecordId, state },
  ];
  assert.deepEqual(await deleteAccount(), { success: false, error: 'has_memberships' }, state);
  assert.deepEqual(world.deletedUserIds, [], `${state}: a member's Auth user was deleted`);
  assert.ok(profileKept(), `${state}: a refused deletion removed the profile`);
  assert.deepEqual(tableRows(world, 'organization_members'), [membership], state);
}

// A failed membership read refuses instead of treating the caller as no member.
world.failingTables.add('organization_members');
assert.deepEqual(await deleteAccount(), { success: false, error: 'delete_failed' });
assert.deepEqual(world.deletedUserIds, []);
world.failingTables.delete('organization_members');

// Without a membership of their own the Auth user goes, whoever else is a
// member; a refused Auth deletion (the database guard, a restricting
// reference) keeps the profile.
world.tables.organization_members = [colleagueMembership];
world.deleteUser = () => ({ error: { message: 'account_deletion_member_has_time_history' } });
assert.deepEqual(await deleteAccount(), { success: false, error: 'delete_failed' });
assert.deepEqual(world.deletedUserIds, [CALLER_ID]);
assert.ok(profileKept(), 'the profile was deleted before the Auth user');

world.deleteUser = () => ({ error: null });
assert.deepEqual(await deleteAccount(), { success: true });
assert.deepEqual(world.deletedUserIds, [CALLER_ID, CALLER_ID]);
assert.ok(profileKept(), 'the action deleted the profile itself instead of through the Auth cascade');

console.info('Account deletion boundaries passed');
