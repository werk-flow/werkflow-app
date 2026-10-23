// The actual project job page over the in-memory database: the page function
// receives the caller's organization, the caller and the caller's role, and a
// job of another organization never reaches the page even when its id does.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const foreignProjectId = '8b000000-0000-4000-8000-000000000001';
const foreignJobId = '8b000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  jobs: [
    { id: foreignJobId, organization_id: ORGANIZATION_B, project_id: foreignProjectId, client_id: null },
  ],
  job_assignments: [],
});
const { getProjectJobPage } = await import('@/lib/jobs/list-actions');

// A caller without an active organization is refused before any database access.
signInAs(world, null);
assert.deepEqual(await getProjectJobPage({ projectId: foreignProjectId, page: 1 }), {
  success: false,
  error: 'no_active_org',
});
assert.equal(world.adminClientRequests, 0);

// The page function scopes by the caller; a foreign id it might return is
// dropped by the organization-scoped job read.
world.rpc = () => ({ data: { ids: [foreignJobId], total: 1 }, error: null });
signInAs(world, 'employee');
const page = await getProjectJobPage({ projectId: foreignProjectId, page: 1 });
assert.deepEqual(page, { success: true, total: 1, jobs: [], assignmentMap: {}, clientMap: {} });
const [call] = world.rpcCalls;
assert.ok(call);
assert.deepEqual(
  [call.name, call.args.p_organization_id, call.args.p_user_id, call.args.p_is_manager],
  ['list_project_job_page', ORGANIZATION_A, CALLER_ID, false],
);
