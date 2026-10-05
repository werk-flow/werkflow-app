// Actual Mitarbeiter actions over the in-memory database: the role rules of
// role changes and removals, the organization boundary of every target, and
// the name visibility across shared organizations.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const ownerId = '30000000-0000-4000-8000-000000000002';
const officeId = '30000000-0000-4000-8000-000000000003';
const workerId = '30000000-0000-4000-8000-000000000004';
const foreignId = '30000000-0000-4000-8000-000000000009';
const exitedId = '30000000-0000-4000-8000-000000000005';
const joinedAt = '2026-01-15T08:00:00.000Z';

const world = installActionWorld({
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero', joined_at: joinedAt },
    { organization_id: ORGANIZATION_A, user_id: ownerId, role: 'admin', joined_at: joinedAt },
    { organization_id: ORGANIZATION_A, user_id: officeId, role: 'buero', joined_at: joinedAt },
    { organization_id: ORGANIZATION_A, user_id: workerId, role: 'employee', joined_at: joinedAt },
    { organization_id: ORGANIZATION_B, user_id: workerId, role: 'employee', joined_at: joinedAt },
    { organization_id: ORGANIZATION_B, user_id: foreignId, role: 'employee', joined_at: joinedAt },
  ],
  profiles: [
    { id: CALLER_ID, first_name: 'Carla', last_name: 'Caller', email: 'carla@example.test' },
    { id: ownerId, first_name: 'Otto', last_name: 'Owner', email: 'otto@example.test' },
    { id: officeId, first_name: 'Olga', last_name: 'Office', email: 'olga@example.test' },
    { id: workerId, first_name: 'Willi', last_name: null, email: 'willi@example.test' },
    { id: foreignId, first_name: 'Frieda', last_name: 'Fremd', email: 'frieda@example.test' },
    { id: exitedId, first_name: 'Emil', last_name: 'Ehemalig', email: 'emil@example.test' },
  ],
  employee_records: [
    {
      id: 'record-worker',
      organization_id: ORGANIZATION_A,
      user_id: workerId,
      first_name: 'Willi',
      last_name: 'Worker',
      exit_date: null,
    },
    {
      id: 'record-exited',
      organization_id: ORGANIZATION_A,
      user_id: exitedId,
      first_name: 'Emil',
      last_name: 'Ehemalig',
      exit_date: '2026-03-31',
    },
  ],
});
const actions = await import('@/lib/members/actions');

/** The role actions read the caller's role from the membership row, so the row follows the session. */
const actAs = (role: 'admin' | 'buero' | 'employee'): void => {
  signInAs(world, role);
  const callerRow = tableRows(world, 'organization_members').find((row) => row.user_id === CALLER_ID);
  assert.ok(callerRow);
  callerRow.role = role;
};
const roleOf = (organizationId: string, userId: string): unknown =>
  tableRows(world, 'organization_members').find(
    (row) => row.organization_id === organizationId && row.user_id === userId,
  )?.role;
const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();

// Signed-out callers are denied everywhere; name lookups answer with nothing.
world.callerId = null;
assert.deepEqual(await actions.updateMemberRole(workerId, 'buero'), {
  success: false,
  error: 'not_authenticated',
});
assert.deepEqual(await actions.removeMember(workerId), { success: false, error: 'not_authenticated' });
assert.deepEqual(await actions.getOrgMembersAction(ORGANIZATION_A), {
  success: false,
  error: 'not_authenticated',
});
assert.deepEqual(await actions.getMemberDetail(workerId), { success: false, error: 'not_authenticated' });
assert.deepEqual(await actions.getProfilesByIds([workerId]), { success: false, error: 'not_authenticated' });
assert.equal(world.adminClientRequests, 0);

// A caller without any organization has no active organization.
signInAs(world, null);
assert.deepEqual(await actions.updateMemberRole(workerId, 'buero'), {
  success: false,
  error: 'no_active_org',
});
assert.deepEqual(await actions.removeMember(workerId), { success: false, error: 'no_active_org' });
assert.deepEqual(await actions.getMemberDetail(workerId), { success: false, error: 'no_active_org' });
assert.deepEqual(await actions.getOrgMembersAction(ORGANIZATION_A), {
  success: false,
  error: 'not_a_member',
});

// A session that still names an organization the caller no longer belongs to is not a membership.
signInAs(world, 'admin', ORGANIZATION_B);
assert.deepEqual(await actions.updateMemberRole(foreignId, 'buero'), {
  success: false,
  error: 'not_a_member',
});
assert.deepEqual(await actions.removeMember(foreignId), { success: false, error: 'not_a_member' });

// Field workers manage nobody and list nobody.
actAs('employee');
assert.deepEqual(await actions.updateMemberRole(workerId, 'buero'), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.removeMember(workerId), { success: false, error: 'not_authorized' });
assert.deepEqual(await actions.getOrgMembersAction(ORGANIZATION_A), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.getMemberDetail(workerId), { success: false, error: 'not_authorized' });

// The office role manages field workers only, never itself, the admin, a peer, or another organization's member.
actAs('buero');
for (const [targetId, newRole, expectedError] of [
  [foreignId, 'employee', 'member_not_found'],
  [CALLER_ID, 'employee', 'cannot_change_own_role'],
  [workerId, 'admin', 'cannot_assign_admin'],
  [ownerId, 'employee', 'cannot_change_admin_role'],
  [officeId, 'employee', 'insufficient_permissions'],
  [workerId, 'buero', 'cannot_assign_buero_role'],
] as const) {
  assert.deepEqual(await actions.updateMemberRole(targetId, newRole), {
    success: false,
    error: expectedError,
  });
}
for (const [targetId, expectedError] of [
  [foreignId, 'member_not_found'],
  [CALLER_ID, 'cannot_remove_self'],
  [ownerId, 'cannot_remove_admin'],
  [officeId, 'insufficient_permissions'],
] as const) {
  assert.deepEqual(await actions.removeMember(targetId), { success: false, error: expectedError });
}
assert.equal(world.rpcCalls.length, 0);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied call may write');

// The office role sees field workers and itself; the admin sees everyone the database returns.
const listedMembers = [
  {
    user_id: CALLER_ID,
    first_name: 'Carla',
    last_name: 'Caller',
    email: 'carla@example.test',
    role: 'buero',
    joined_at: joinedAt,
  },
  {
    user_id: ownerId,
    first_name: 'Otto',
    last_name: 'Owner',
    email: 'otto@example.test',
    role: 'admin',
    joined_at: joinedAt,
  },
  {
    user_id: officeId,
    first_name: 'Olga',
    last_name: 'Office',
    email: 'olga@example.test',
    role: 'buero',
    joined_at: joinedAt,
  },
  {
    user_id: workerId,
    first_name: 'Willi',
    last_name: '',
    email: 'willi@example.test',
    role: 'employee',
    joined_at: joinedAt,
  },
];
world.rpc = () => ({ data: listedMembers, error: null });
const officeList = await actions.getOrgMembersAction(ORGANIZATION_A);
assert.ok(officeList.success);
assert.deepEqual(
  officeList.members.map((member) => member.user_id),
  [CALLER_ID, workerId],
);
assert.deepEqual(
  [...world.rpcCalls],
  [{ name: 'get_org_members_for_user', args: { p_org_id: ORGANIZATION_A, p_user_id: CALLER_ID } }],
);
assert.deepEqual(await actions.getOrgMembersAction(ORGANIZATION_B), {
  success: false,
  error: 'not_a_member',
});
actAs('admin');
const adminList = await actions.getOrgMembersAction(ORGANIZATION_A);
assert.ok(adminList.success);
assert.equal(adminList.members.length, 4);
// A failed member read is a failure, never an empty member list.
world.rpc = () => ({ data: null, error: { message: 'connection reset' } });
assert.deepEqual(await actions.getOrgMembersAction(ORGANIZATION_A), { success: false, error: 'load_failed' });
world.rpc = () => ({ data: null, error: null });
world.rpcCalls.length = 0;

// Member detail is limited to the active organization and fills missing name parts with empty text.
assert.deepEqual(await actions.getMemberDetail(foreignId), { success: false, error: 'not_found' });
assert.deepEqual(await actions.getMemberDetail(workerId), {
  success: true,
  member: {
    userId: workerId,
    firstName: 'Willi',
    lastName: '',
    email: 'willi@example.test',
    role: 'employee',
    joinedAt,
  },
});

// Names are visible for co-members and for people with a personnel record here, never for strangers.
assert.deepEqual(await actions.getProfilesByIds([]), { success: true, profiles: {} });
assert.deepEqual(await actions.getProfilesByIds([workerId, foreignId, exitedId, CALLER_ID, workerId]), {
  success: true,
  profiles: {
    [workerId]: { firstName: 'Willi', lastName: null },
    [exitedId]: { firstName: 'Emil', lastName: 'Ehemalig' },
    [CALLER_ID]: { firstName: 'Carla', lastName: 'Caller' },
  },
});

// The admin changes a role in the active organization only; the same person's other membership stays.
assert.deepEqual(await actions.updateMemberRole(workerId, 'buero'), { success: true });
assert.deepEqual([roleOf(ORGANIZATION_A, workerId), roleOf(ORGANIZATION_B, workerId)], ['buero', 'employee']);

// Database refusals of a removal reach the caller as stable codes.
for (const [databaseMessage, expectedError] of [
  ['time_member_removal_has_history', 'has_time_history'],
  ['member_removal_exit_before_entry', 'exit_before_entry'],
  ['last_responsibility_holder:leave_approval', 'last_responsibility_holder:leave_approval'],
  ['last_responsibility_holder:time_approval', 'last_responsibility_holder:time_approval'],
  ['deadlock detected', 'delete_failed'],
] as const) {
  world.rpc = () => ({ data: null, error: { message: databaseMessage } });
  assert.deepEqual(await actions.removeMember(workerId), { success: false, error: expectedError });
}

// A removal is one database call naming organization, target and actor. The
// exit date and its event are written inside that call
// (supabase/tests/people_atomic_writes.sql), never by a second statement here.
world.rpcCalls.length = 0;
world.rpc = () => ({ data: true, error: null });
const databaseBeforeRemoval = databaseSnapshot();
assert.deepEqual(await actions.removeMember(workerId), { success: true });
assert.equal(world.rpcCalls.length, 1);
const [removal] = world.rpcCalls;
assert.ok(removal);
assert.equal(removal.name, 'remove_member_with_time_capture');
assert.deepEqual(
  [removal.args.p_organization_id, removal.args.p_target_user_id, removal.args.p_actor_id],
  [ORGANIZATION_A, workerId, CALLER_ID],
);
assert.equal(
  databaseSnapshot(),
  databaseBeforeRemoval,
  'the removal writes only through its database function',
);
