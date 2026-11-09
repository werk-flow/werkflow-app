// The actual attach action and its two readers over the in-memory database:
// only managers pass, the organization and actor come from the session, a
// Büro member who sends another organization's request or job id attaches
// nothing, invalid input never reaches the database, and the database
// function's refusals keep their codes.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const requestId = '60000000-0000-4000-8000-000000000001';
const clientId = '70000000-0000-4000-8000-000000000001';
const foreignClientId = '70000000-0000-4000-8000-000000000009';
const ownJobId = '90000000-0000-4000-8000-000000000001';
const foreignJobId = '90000000-0000-4000-8000-000000000009';
const attachKey = '91000000-0000-4000-8000-000000000001';
const entryId = '92000000-0000-4000-8000-000000000001';

const world = installActionWorld({
  client_requests: [{ id: requestId, organization_id: ORGANIZATION_A, client_id: clientId, status: 'offen' }],
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A, client_id: clientId },
    { id: foreignJobId, organization_id: ORGANIZATION_B, client_id: foreignClientId },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' }],
});
const { attachRequestToWork } = await import('@/lib/requests/attach-actions');
const { getRequestWorkTargets, getWorkRequestEntries } = await import('@/lib/requests/work-attach-server');

// attach_client_request_to_work as supabase/tests/request_attach_to_work.sql
// proves it, reduced to the organization: a request or job outside the passed
// organization is not found.
world.rpc = ({ name, args }) => {
  assert.equal(name, 'attach_client_request_to_work');
  const request = tableRows(world, 'client_requests').find(
    (row) => row.id === args.p_request_id && row.organization_id === args.p_organization_id,
  );
  if (!request) return { data: null, error: { message: 'request_not_found' } };
  const job = tableRows(world, 'jobs').find(
    (row) => row.id === args.p_job_id && row.organization_id === args.p_organization_id,
  );
  return job ? { data: { id: entryId }, error: null } : { data: null, error: { message: 'work_not_found' } };
};
const attachArgs = (jobId: string) => ({
  name: 'attach_client_request_to_work',
  args: {
    p_organization_id: ORGANIZATION_A,
    p_actor_id: CALLER_ID,
    p_request_id: requestId,
    p_job_id: jobId,
    p_project_id: null,
    p_service_case_id: null,
    p_attempt_key: attachKey,
  },
});

// Signed-out callers, callers without an organization and field workers
// attach nothing and read neither the open work nor a work's attached requests.
const everyCall = (): Array<Promise<{ success: boolean; error?: string }>> => [
  attachRequestToWork(requestId, { kind: 'job', id: ownJobId }, attachKey),
  getRequestWorkTargets({ requestId, query: '' }),
  getWorkRequestEntries({ kind: 'job', id: ownJobId }),
];
world.callerId = null;
for (const result of await Promise.all(everyCall()))
  assert.deepEqual(result, { success: false, error: 'not_authenticated' });
signInAs(world, null);
for (const result of await Promise.all(everyCall()))
  assert.deepEqual(result, { success: false, error: 'no_active_org' });
signInAs(world, 'employee');
for (const result of await Promise.all(everyCall()))
  assert.deepEqual(result, { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, 0);
assert.deepEqual(world.rpcCalls, []);

// A Büro member who sends another organization's job id attaches nothing; the
// own job is attached with the session's organization and actor.
signInAs(world, 'buero');
assert.deepEqual(await attachRequestToWork(requestId, { kind: 'job', id: foreignJobId }, attachKey), {
  success: false,
  error: 'work_not_found',
});
assert.deepEqual(await attachRequestToWork(requestId, { kind: 'job', id: ownJobId }, attachKey), {
  success: true,
  entryId,
});
assert.deepEqual(world.rpcCalls, [attachArgs(foreignJobId), attachArgs(ownJobId)]);

// A Büro member of the other organization reaches neither this request nor its work.
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(await attachRequestToWork(requestId, { kind: 'job', id: ownJobId }, attachKey), {
  success: false,
  error: 'request_not_found',
});
signInAs(world, 'buero');

// Without a valid work kind, work id or attempt key nothing reaches the database.
world.rpcCalls.length = 0;
for (const [work, key] of [
  [{ kind: 'offer', id: ownJobId }, attachKey],
  [{ kind: 'job', id: 'not-a-uuid' }, attachKey],
  [{ kind: 'job', id: ownJobId }, 'not-a-uuid'],
] as const) {
  assert.deepEqual(await attachRequestToWork(requestId, work, key), {
    success: false,
    error: 'invalid_input',
  });
}
assert.deepEqual(world.rpcCalls, []);

// The function's refusals keep their codes; any other failure is attach_failed.
for (const refusal of ['already_attached', 'work_closed', 'work_client_mismatch', 'request_not_editable']) {
  world.rpc = () => ({ data: null, error: { message: refusal } });
  assert.deepEqual(await attachRequestToWork(requestId, { kind: 'service_case', id: ownJobId }, attachKey), {
    success: false,
    error: refusal,
  });
}
world.rpc = () => ({ data: null, error: { message: 'connection failure' } });
assert.deepEqual(await attachRequestToWork(requestId, { kind: 'project', id: ownJobId }, attachKey), {
  success: false,
  error: 'attach_failed',
});

// The open-work read asks for the session's organization, one row past its
// limit, and says when more match; a foreign request stays not found.
world.rpcCalls.length = 0;
world.rpc = ({ args }) =>
  args.p_request_id === requestId && args.p_organization_id === ORGANIZATION_A
    ? {
        data: Array.from({ length: 51 }, (_, index) => ({
          kind: 'job',
          id: `90000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
          number: `A-${index}`,
          title: 'Heizungswartung',
          site_label: null,
          at_request_site: index === 0,
        })),
        error: null,
      }
    : { data: null, error: { message: 'request_not_found' } };
const page = await getRequestWorkTargets({ requestId, query: 'Heiz' });
assert.ok(page.success);
assert.equal(page.targets.length, 50);
assert.equal(page.hasMore, true);
assert.deepEqual(world.rpcCalls, [
  {
    name: 'list_request_work_targets',
    args: { p_organization_id: ORGANIZATION_A, p_request_id: requestId, p_search: 'Heiz', p_limit: 51 },
  },
]);
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(await getRequestWorkTargets({ requestId, query: '' }), {
  success: false,
  error: 'request_not_found',
});
