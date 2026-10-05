// Actual Anfragen actions over the in-memory database: only managers pass,
// a request of another organization is unreachable, invalid input writes
// nothing, and a request converts exactly once.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const openRequestId = '60000000-0000-4000-8000-000000000001';
const foreignRequestId = '60000000-0000-4000-8000-000000000002';
const closedRequestId = '60000000-0000-4000-8000-000000000003';
const anonymousRequestId = '60000000-0000-4000-8000-000000000004';
const clientId = '70000000-0000-4000-8000-000000000001';
const secondClientId = '70000000-0000-4000-8000-000000000002';
const foreignClientId = '70000000-0000-4000-8000-000000000009';
const siteId = '80000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';

const requestRow = (
  id: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  request_number: null,
  client_id: null,
  contact_id: null,
  site_id: null,
  caller_name: 'Erika Muster',
  caller_phone: '0301234567',
  caller_email: 'erika@example.test',
  caller_address: 'Hauptstraße 1, 10115 Berlin',
  summary: 'Heizung fällt aus',
  details: null,
  category: 'stoerung_reparatur',
  urgency: 'hoch',
  source: 'telefon',
  status: 'offen',
  assigned_to: null,
  received_at: now,
  closed_reason: null,
  closed_note: null,
  closed_by: null,
  closed_at: null,
  converted_job_id: null,
  converted_project_id: null,
  converted_by: null,
  converted_at: null,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const world = installActionWorld(
  {
    client_requests: [
      requestRow(openRequestId, ORGANIZATION_A, { request_number: 'AN-0001' }),
      requestRow(foreignRequestId, ORGANIZATION_B),
      requestRow(closedRequestId, ORGANIZATION_A, {
        status: 'geschlossen',
        closed_reason: 'duplikat',
        closed_note: 'Doppelt erfasst',
        closed_by: CALLER_ID,
        closed_at: now,
      }),
      requestRow(anonymousRequestId, ORGANIZATION_A, { caller_name: null }),
    ],
    client_request_events: [],
    clients: [
      { id: clientId, organization_id: ORGANIZATION_A, name: 'Bestandskunde' },
      { id: secondClientId, organization_id: ORGANIZATION_A, name: 'Zweiter Kunde' },
      { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' },
    ],
    client_sites: [
      {
        id: siteId,
        organization_id: ORGANIZATION_A,
        client_id: clientId,
        street: 'Werkstraße 5',
        postal_code: '10115',
        city: 'Berlin',
      },
    ],
    client_contacts: [],
    organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' }],
    projects: [],
    jobs: [],
    document_links: [],
  },
  {
    client_requests: () => requestRow('', '', { created_by: null }),
    projects: () => ({ created_at: now, updated_at: now }),
  },
);
const actions = await import('@/lib/requests/actions');

const requestById = (id: string): Record<string, unknown> => {
  const row = tableRows(world, 'client_requests').find((candidate) => candidate.id === id);
  assert.ok(row, `request ${id} exists`);
  return row;
};
const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();

// Signed-out callers, callers without an organization and field workers are
// denied by every action before the database is touched.
const everyAction = (requestId: string): Array<Promise<{ success: boolean; error?: string }>> => [
  actions.createClientRequest({ summary: 'Neue Anfrage' }),
  actions.updateClientRequest(requestId, { summary: 'Geändert' }),
  actions.promoteCallerToClient(requestId),
  actions.closeClientRequest(requestId, { reason: 'kein_bedarf' }),
  actions.reopenClientRequest(closedRequestId),
  actions.convertRequestToJob(requestId, { title: 'Auftrag', clientId }),
  actions.convertRequestToProject(requestId, { name: 'Projekt', clientId, projectNumber: 'P-1' }),
  actions.getNextRequestNumber(),
];
world.callerId = null;
for (const result of await Promise.all(everyAction(openRequestId)))
  assert.deepEqual(result, { success: false, error: 'not_authenticated' });
signInAs(world, null);
for (const result of await Promise.all(everyAction(openRequestId)))
  assert.deepEqual(result, { success: false, error: 'no_active_org' });
signInAs(world, 'employee');
for (const result of await Promise.all(everyAction(openRequestId)))
  assert.deepEqual(result, { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, 0);

// A manager of this organization cannot reach a request of another organization through any action.
signInAs(world, 'buero');
const foreignResults = await Promise.all([
  actions.updateClientRequest(foreignRequestId, { summary: 'Geändert' }),
  actions.promoteCallerToClient(foreignRequestId),
  actions.closeClientRequest(foreignRequestId, { reason: 'kein_bedarf' }),
  actions.reopenClientRequest(foreignRequestId),
  actions.convertRequestToJob(foreignRequestId, { title: 'Auftrag', clientId }),
  actions.convertRequestToProject(foreignRequestId, { name: 'Projekt', clientId, projectNumber: 'P-1' }),
]);
for (const result of foreignResults) assert.deepEqual(result, { success: false, error: 'request_not_found' });

// Capture rejects bad input without writing a request. Foreign references, a
// non-member assignee and a taken number are refused by create_client_request
// under its lock (supabase/tests/request_history_writes.sql).
for (const [input, expectedError] of [
  [{ summary: '   ' }, 'summary_required'],
  [{ summary: 'Anfrage', assignedTo: 'not-a-member' }, 'assignee_not_found'],
  [{ summary: 'Anfrage', receivedAt: 'gestern' }, 'invalid_received_at'],
] as const) {
  assert.deepEqual(await actions.createClientRequest(input), { success: false, error: expectedError });
}

// Edits of closed requests, empty edits and invalid edits change nothing.
assert.deepEqual(await actions.updateClientRequest(closedRequestId, { summary: 'Neu' }), {
  success: false,
  error: 'request_not_editable',
});
assert.deepEqual(await actions.closeClientRequest(closedRequestId, { reason: 'abgelehnt' }), {
  success: false,
  error: 'request_not_editable',
});
assert.deepEqual(await actions.promoteCallerToClient(closedRequestId), {
  success: false,
  error: 'request_not_editable',
});
assert.deepEqual(await actions.updateClientRequest(openRequestId, {}), {
  success: false,
  error: 'no_changes',
});
assert.deepEqual(await actions.updateClientRequest(openRequestId, { summary: ' ' }), {
  success: false,
  error: 'summary_required',
});
assert.deepEqual(await actions.updateClientRequest(openRequestId, { receivedAt: 'gestern' }), {
  success: false,
  error: 'invalid_received_at',
});
assert.deepEqual(await actions.reopenClientRequest(openRequestId), {
  success: false,
  error: 'request_not_closed',
});
assert.deepEqual(await actions.promoteCallerToClient(anonymousRequestId), {
  success: false,
  error: 'caller_name_required',
});

// Conversion guards answer before any work is created.
assert.deepEqual(await actions.convertRequestToJob(closedRequestId, { title: 'Auftrag', clientId }), {
  success: false,
  error: 'already_converted',
});
assert.deepEqual(
  await actions.convertRequestToJob(openRequestId, {
    title: 'Auftrag',
    clientId,
    projectId: 'existing-project',
  }),
  { success: false, error: 'standalone_job_only' },
);
assert.deepEqual(await actions.convertRequestToJob(openRequestId, { title: 'Auftrag' }), {
  success: false,
  error: 'client_required',
});
assert.deepEqual(
  await actions.convertRequestToProject(closedRequestId, { name: 'Projekt', clientId, projectNumber: 'P-1' }),
  { success: false, error: 'already_converted' },
);
assert.deepEqual(
  await actions.convertRequestToProject(openRequestId, { name: 'Projekt', projectNumber: 'P-1' }),
  { success: false, error: 'client_required' },
);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied or rejected call may write');

// Capture, edit, close and reopen are one call each of their database function
// with server-resolved values only: the trimmed input in the caller's
// organization, the documented defaults, and a customer change that drops the
// previous customer's site and contact. supabase/tests/request_history_writes.sql
// proves that each call writes the request and its history row together.
const rpcBeforeRequestWrites = world.rpc;
const savedRequest = requestRow('60000000-0000-4000-8000-000000000007', ORGANIZATION_A);
world.rpcCalls.length = 0;
world.rpc = () => ({ data: { ...savedRequest }, error: null });
const requestWrites = await Promise.all([
  actions.createClientRequest({
    summary: '  Wasserhahn tropft  ',
    requestNumber: ' AN-0009 ',
    clientId,
    siteId,
    assignedTo: CALLER_ID,
  }),
  actions.updateClientRequest(openRequestId, { clientId, siteId }),
  actions.updateClientRequest(openRequestId, { clientId: secondClientId, assignedTo: ` ${CALLER_ID} ` }),
  actions.updateClientRequest(openRequestId, { status: 'in_klaerung', requestNumber: ' ' }),
  actions.closeClientRequest(openRequestId, { reason: 'kein_bedarf', note: '  erledigt sich  ' }),
  actions.reopenClientRequest(closedRequestId),
]);
assert.deepEqual(
  requestWrites.map((result) => (result.success ? result.request.id : result.error)),
  requestWrites.map(() => savedRequest.id),
);
const writeArgs = { p_actor_id: CALLER_ID, p_organization_id: ORGANIZATION_A };
assert.deepEqual(world.rpcCalls, [
  {
    name: 'create_client_request',
    args: {
      ...writeArgs,
      p_summary: 'Wasserhahn tropft',
      p_details: null,
      p_request_number: 'AN-0009',
      p_client_id: clientId,
      p_site_id: siteId,
      p_contact_id: null,
      p_caller_name: null,
      p_caller_phone: null,
      p_caller_email: null,
      p_caller_address: null,
      p_category: 'sonstiges',
      p_urgency: 'normal',
      p_source: 'telefon',
      p_assigned_to: CALLER_ID,
      p_received_at: null,
    },
  },
  {
    name: 'update_client_request',
    args: {
      ...writeArgs,
      p_request_id: openRequestId,
      p_changes: { client_id: clientId, site_id: siteId, contact_id: null },
    },
  },
  {
    name: 'update_client_request',
    args: {
      ...writeArgs,
      p_request_id: openRequestId,
      p_changes: { assigned_to: CALLER_ID, client_id: secondClientId, site_id: null, contact_id: null },
    },
  },
  {
    name: 'update_client_request',
    args: {
      ...writeArgs,
      p_request_id: openRequestId,
      p_changes: { status: 'in_klaerung', request_number: null },
    },
  },
  {
    name: 'close_client_request',
    args: { ...writeArgs, p_request_id: openRequestId, p_reason: 'kein_bedarf', p_note: 'erledigt sich' },
  },
  { name: 'reopen_client_request', args: { ...writeArgs, p_request_id: closedRequestId } },
]);

// A refusal under the database lock keeps its code; any other failure, such
// as a refused history row, is the action's own failure code.
world.rpc = () => ({ data: null, error: { message: 'request_number_taken' } });
assert.deepEqual(await actions.createClientRequest({ summary: 'Anfrage', requestNumber: 'AN-0001' }), {
  success: false,
  error: 'request_number_taken',
});
world.rpc = () => ({ data: null, error: { message: 'client_not_found' } });
assert.deepEqual(await actions.updateClientRequest(openRequestId, { clientId: foreignClientId }), {
  success: false,
  error: 'client_not_found',
});
world.rpc = () => ({ data: null, error: { message: 'request_not_editable' } });
assert.deepEqual(await actions.closeClientRequest(openRequestId, { reason: 'abgelehnt' }), {
  success: false,
  error: 'request_not_editable',
});
world.rpc = () => ({ data: null, error: { message: 'request_not_closed' } });
assert.deepEqual(await actions.reopenClientRequest(closedRequestId), {
  success: false,
  error: 'request_not_closed',
});
world.rpc = () => ({ data: null, error: { message: 'history refused' } });
assert.deepEqual(
  await Promise.all([
    actions.createClientRequest({ summary: 'Anfrage' }),
    actions.updateClientRequest(openRequestId, { summary: 'Geändert' }),
    actions.closeClientRequest(openRequestId, { reason: 'abgelehnt' }),
    actions.reopenClientRequest(closedRequestId),
  ]),
  ['create_failed', 'update_failed', 'close_failed', 'reopen_failed'].map((error) => ({
    success: false,
    error,
  })),
);
world.rpc = rpcBeforeRequestWrites;
assert.equal(
  databaseSnapshot(),
  initialDatabase,
  'the request writes reach the database only through their functions',
);

// Promoting an unknown caller is one call of promote_client_request_caller with
// server-resolved values only; the stub applies it as the SQL test proves it.
const promotedRequestId = '60000000-0000-4000-8000-000000000005';
const promotedClientId = '70000000-0000-4000-8000-000000000005';
world.tables.client_requests?.push(requestRow(promotedRequestId, ORGANIZATION_A));
world.rpcCalls.length = 0;
world.rpc = ({ name, args }) => {
  assert.equal(name, 'promote_client_request_caller');
  const request = requestById(String(args.p_request_id));
  world.tables.clients?.push({
    id: promotedClientId,
    organization_id: args.p_organization_id,
    name: args.p_name,
    client_type: args.p_client_type,
    email: request.caller_email,
    phone: request.caller_phone,
  });
  request.client_id = promotedClientId;
  return { data: { ...request }, error: null };
};
const promoted = await actions.promoteCallerToClient(promotedRequestId);
assert.ok(promoted.success);
assert.equal(promoted.request.clientId, promotedClientId);
assert.deepEqual(world.rpcCalls, [
  {
    name: 'promote_client_request_caller',
    args: {
      p_actor_id: CALLER_ID,
      p_organization_id: ORGANIZATION_A,
      p_request_id: promotedRequestId,
      p_name: 'Erika Muster',
      p_client_type: 'privat',
    },
  },
]);
assert.deepEqual(await actions.promoteCallerToClient(promotedRequestId), {
  success: false,
  error: 'already_matched',
});
assert.equal(tableRows(world, 'clients').length, 4);

// A refusal under the database lock keeps its code; any other failure is promote_failed.
const racedRequestId = '60000000-0000-4000-8000-000000000006';
world.tables.client_requests?.push(requestRow(racedRequestId, ORGANIZATION_A));
world.rpc = () => ({ data: null, error: { message: 'already_matched' } });
assert.deepEqual(await actions.promoteCallerToClient(racedRequestId), {
  success: false,
  error: 'already_matched',
});
world.rpc = () => ({ data: null, error: { message: 'history refused' } });
assert.deepEqual(await actions.promoteCallerToClient(racedRequestId), {
  success: false,
  error: 'promote_failed',
});
assert.equal(tableRows(world, 'clients').length, 4);

// A conversion is one call of convert_client_request_to_project with
// server-resolved values only; the stub applies the claim as the SQL test
// proves it (supabase/tests/work_creation_writes.sql). A converted request
// refuses a second conversion before any call.
const convertedProjectId = '90000000-0000-4000-8000-0000000000c1';
world.rpcCalls.length = 0;
world.rpc = ({ name, args }) => {
  if (name !== 'convert_client_request_to_project')
    return { data: null, error: { message: 'unexpected call' } };
  Object.assign(requestById(String(args.p_request_id)), {
    status: 'umgewandelt',
    converted_project_id: convertedProjectId,
    converted_by: args.p_actor_id,
  });
  return { data: { id: convertedProjectId, project_number: 'P-2026-001' }, error: null };
};
const converted = await actions.convertRequestToProject(openRequestId, {
  name: ' Heizungstausch ',
  clientId: secondClientId,
  projectNumber: 'P-2026-001',
});
assert.deepEqual(converted, {
  success: true,
  target: 'project',
  projectId: convertedProjectId,
  projectNumber: 'P-2026-001',
});
assert.deepEqual(world.rpcCalls, [
  {
    name: 'convert_client_request_to_project',
    args: {
      p_organization_id: ORGANIZATION_A,
      p_actor_id: CALLER_ID,
      p_request_id: openRequestId,
      p_project: {
        name: 'Heizungstausch',
        description: null,
        client_id: secondClientId,
        site_id: null,
        contact_id: null,
        project_number: 'P-2026-001',
        planned_start_date: null,
        planned_end_date: null,
      },
      p_template_version_id: null,
    },
  },
]);
assert.deepEqual(
  await actions.convertRequestToProject(openRequestId, {
    name: 'Heizungstausch',
    clientId: secondClientId,
    projectNumber: 'P-2026-002',
  }),
  { success: false, error: 'already_converted' },
);
assert.equal(world.rpcCalls.length, 1);
assert.deepEqual(await actions.updateClientRequest(openRequestId, { summary: 'Nachtrag' }), {
  success: false,
  error: 'request_not_editable',
});
// A conversion that lost the race under the lock, or a refused work step,
// keeps its code; any other failure is create_failed.
const racedConversionId = '60000000-0000-4000-8000-000000000008';
world.tables.client_requests?.push(requestRow(racedConversionId, ORGANIZATION_A));
for (const refusal of ['already_converted', 'project_number_taken', 'work_template_version_unavailable']) {
  world.rpc = () => ({ data: null, error: { message: refusal } });
  assert.deepEqual(
    await actions.convertRequestToProject(racedConversionId, {
      name: 'Projekt',
      clientId,
      projectNumber: 'P-2026-003',
    }),
    { success: false, error: refusal },
  );
}
world.rpc = () => ({ data: null, error: { message: 'history refused' } });
assert.deepEqual(
  await actions.convertRequestToProject(racedConversionId, {
    name: 'Projekt',
    clientId,
    projectNumber: 'P-2026-003',
  }),
  { success: false, error: 'create_failed' },
);
assert.equal(tableRows(world, 'projects').length, 0);

// The number generator is asked for the caller's organization; a database failure is a stable code.
world.rpcCalls.length = 0;
world.rpc = () => ({ data: 'AN-0002', error: null });
assert.deepEqual(await actions.getNextRequestNumber(), { success: true, requestNumber: 'AN-0002' });
assert.deepEqual(world.rpcCalls, [{ name: 'generate_request_number', args: { p_org_id: ORGANIZATION_A } }]);
world.rpc = () => ({ data: null, error: { message: 'sequence unavailable' } });
assert.deepEqual(await actions.getNextRequestNumber(), { success: false, error: 'generation_failed' });

// Nothing above touched the other organization's request.
assert.deepEqual(requestById(foreignRequestId), requestRow(foreignRequestId, ORGANIZATION_B));
