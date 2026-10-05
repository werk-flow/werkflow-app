// Actual join-request decision actions over the in-memory database: only
// Admin and Büro of the active organization decide, a request of another
// organization is never reached, the approval passes the server-resolved
// organization and approver to the database function, and a requester
// withdraws only their own open request.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const ownRequestId = '40000000-0000-4000-8000-000000000001';
const foreignRequestId = '40000000-0000-4000-8000-000000000002';
const callerRequestId = '40000000-0000-4000-8000-000000000003';
const requesterId = '30000000-0000-4000-8000-000000000011';
const foreignRequesterId = '30000000-0000-4000-8000-000000000012';
const pending = (id: string, organizationId: string, userId: string) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
  status: 'pending',
  requested_at: '2026-10-02T08:00:00.000Z',
  decided_at: null,
  decided_by: null,
});

const world = installActionWorld({
  organization_join_requests: [
    pending(ownRequestId, ORGANIZATION_A, requesterId),
    pending(foreignRequestId, ORGANIZATION_B, foreignRequesterId),
    pending(callerRequestId, ORGANIZATION_B, CALLER_ID),
  ],
});
// The database function finds a request only inside the organization it is given.
world.rpc = ({ name, args }) => {
  assert.equal(name, 'approve_organization_join_request');
  const request = tableRows(world, 'organization_join_requests').find(
    (row) => row.id === args.p_request_id && row.organization_id === args.p_organization_id,
  );
  if (!request) return { data: null, error: { message: 'join_request_not_found' } };
  if (request.status !== 'pending') return { data: null, error: { message: 'join_request_not_pending' } };
  request.status = 'approved';
  return { data: request.user_id, error: null };
};
const actions = await import('@/lib/org/join-request-actions');

const statusOf = (id: string): unknown =>
  tableRows(world, 'organization_join_requests').find((row) => row.id === id)?.status;
const decisionActions = [actions.approveOrganizationJoinRequest, actions.declineOrganizationJoinRequest];

// Signed-out callers are denied before the database is touched.
world.callerId = null;
for (const decide of decisionActions) {
  assert.deepEqual(await decide(ownRequestId), { success: false, error: 'not_authenticated' });
}
assert.deepEqual(await actions.withdrawOrganizationJoinRequest(callerRequestId), {
  success: false,
  error: 'not_authenticated',
});

// A malformed id is refused before identity and database work.
signInAs(world, 'admin');
for (const decide of decisionActions) {
  assert.deepEqual(await decide('not-a-uuid'), { success: false, error: 'invalid_input' });
}
assert.deepEqual(await actions.withdrawOrganizationJoinRequest('not-a-uuid'), {
  success: false,
  error: 'invalid_input',
});

// An employee decides nothing.
signInAs(world, 'employee');
for (const decide of decisionActions) {
  assert.deepEqual(await decide(ownRequestId), { success: false, error: 'not_authorized' });
}
assert.equal(world.rpcCalls.length, 0);
assert.equal(statusOf(ownRequestId), 'pending');

// Büro of organization A cannot reach organization B's request: the approval
// names A, and the decline filters by A.
signInAs(world, 'buero');
assert.deepEqual(await actions.approveOrganizationJoinRequest(foreignRequestId), {
  success: false,
  error: 'request_not_pending',
});
assert.deepEqual(world.rpcCalls.at(-1)?.args, {
  p_request_id: foreignRequestId,
  p_organization_id: ORGANIZATION_A,
  p_approver_id: CALLER_ID,
});
assert.deepEqual(await actions.declineOrganizationJoinRequest(foreignRequestId), {
  success: false,
  error: 'request_not_pending',
});
assert.equal(statusOf(foreignRequestId), 'pending');

// Büro approves the request of its own organization; a second decision finds it closed.
assert.deepEqual(await actions.approveOrganizationJoinRequest(ownRequestId), { success: true });
assert.equal(statusOf(ownRequestId), 'approved');
assert.deepEqual(await actions.declineOrganizationJoinRequest(ownRequestId), {
  success: false,
  error: 'request_not_pending',
});
assert.deepEqual(await actions.approveOrganizationJoinRequest(ownRequestId), {
  success: false,
  error: 'request_not_pending',
});

// Admin of organization B declines there, with the decision recorded.
signInAs(world, 'admin', ORGANIZATION_B);
assert.deepEqual(await actions.declineOrganizationJoinRequest(foreignRequestId), { success: true });
const declined = tableRows(world, 'organization_join_requests').find((row) => row.id === foreignRequestId);
assert.equal(declined?.status, 'declined');
assert.equal(declined?.decided_by, CALLER_ID);
assert.equal(typeof declined?.decided_at, 'string');

// A requester withdraws only their own open request.
signInAs(world, null);
assert.deepEqual(await actions.withdrawOrganizationJoinRequest(foreignRequestId), {
  success: false,
  error: 'request_not_pending',
});
assert.equal(statusOf(foreignRequestId), 'declined');
assert.deepEqual(await actions.withdrawOrganizationJoinRequest(callerRequestId), { success: true });
assert.equal(statusOf(callerRequestId), 'withdrawn');
assert.deepEqual(await actions.withdrawOrganizationJoinRequest(callerRequestId), {
  success: false,
  error: 'request_not_pending',
});
