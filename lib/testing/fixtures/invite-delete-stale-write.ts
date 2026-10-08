// The real deleteInvite over the in-memory database: an invite that turned
// pending again after the status read (a failed resend restores it) is not
// deleted, and the action answers must_cancel_first.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';

const restoredId = '00000000-0000-4000-8000-0000000000e1';
const cancelledId = '00000000-0000-4000-8000-0000000000e2';
const inviteRow = (id: string): Record<string, unknown> => ({
  id,
  organization_id: ORGANIZATION_A,
  email: `${id}@example.test`,
  invite_code: `code-${id}`,
  invited_role: 'employee',
  status: 'cancelled',
});

const world = installActionWorld({
  organization_invites: [inviteRow(restoredId), inviteRow(cancelledId)],
});
const { deleteInvite } = await import('@/lib/invites/delete-action');

const inviteStatus = (id: string): unknown =>
  tableRows(world, 'organization_invites').find((invite) => invite.id === id)?.status;
signInAs(world, 'buero');

world.beforeNextWrite = (table) => {
  assert.equal(table, 'organization_invites');
  const invite = tableRows(world, 'organization_invites').find((row) => row.id === restoredId);
  assert.ok(invite);
  invite.status = 'pending';
};
assert.deepEqual(await deleteInvite(restoredId), { success: false, error: 'must_cancel_first' });
assert.equal(world.beforeNextWrite, null, 'the action reached its write');
assert.equal(inviteStatus(restoredId), 'pending');

// An invite that stayed cancelled is deleted.
assert.deepEqual(await deleteInvite(cancelledId), { success: true });
assert.equal(inviteStatus(cancelledId), undefined);
assert.equal(inviteStatus(restoredId), 'pending');
