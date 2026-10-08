// The real updateMemberRole over the in-memory database: a role decided on a
// membership row that changed before the write lands refuses as
// member_changed and leaves the newer row as it is.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';

const workerId = '30000000-0000-4000-8000-000000000004';
const joinedAt = '2026-01-15T08:00:00.000Z';

const world = installActionWorld({
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero', joined_at: joinedAt },
    { organization_id: ORGANIZATION_A, user_id: workerId, role: 'employee', joined_at: joinedAt },
  ],
});
const { updateMemberRole } = await import('@/lib/members/actions');

const workerRow = (): Record<string, unknown> | undefined =>
  tableRows(world, 'organization_members').find((row) => row.user_id === workerId);
const setWorkerRole = (role: string): void => {
  const row = workerRow();
  assert.ok(row);
  row.role = role;
};
signInAs(world, 'buero');

// Büro decides on a field worker; an admin raises the worker to Büro before
// the write. The write names the role it decided on, so it changes nothing.
world.beforeNextWrite = (table) => {
  assert.equal(table, 'organization_members');
  setWorkerRole('buero');
};
assert.deepEqual(await updateMemberRole(workerId, 'employee'), { success: false, error: 'member_changed' });
assert.equal(world.beforeNextWrite, null, 'the action reached its write');
assert.equal(workerRow()?.role, 'buero');

// A membership removed between the checks and the write refuses the same way.
setWorkerRole('employee');
world.beforeNextWrite = () => {
  world.tables.organization_members = tableRows(world, 'organization_members').filter(
    (row) => row.user_id !== workerId,
  );
};
assert.deepEqual(await updateMemberRole(workerId, 'employee'), { success: false, error: 'member_changed' });
assert.equal(workerRow(), undefined);

// An admin's change on an unchanged row succeeds and writes the new role.
tableRows(world, 'organization_members').push({
  organization_id: ORGANIZATION_A,
  user_id: workerId,
  role: 'employee',
  joined_at: joinedAt,
});
signInAs(world, 'admin');
const callerRow = tableRows(world, 'organization_members').find((row) => row.user_id === CALLER_ID);
assert.ok(callerRow);
callerRow.role = 'admin';
assert.deepEqual(await updateMemberRole(workerId, 'buero'), { success: true });
assert.equal(workerRow()?.role, 'buero');
