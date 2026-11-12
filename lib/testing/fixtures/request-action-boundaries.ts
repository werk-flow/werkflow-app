// Actual Anfragen actions over the in-memory database: only managers pass,
// a request of another organization is unreachable, the caller match lookup
// never lists another organization's customer, invalid input writes nothing,
// a caller who matches a customer is promoted only after a confirmation, and
// a request converts exactly once.
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
const matchingClientId = '70000000-0000-4000-8000-000000000003';
const foreignTwinClientId = '70000000-0000-4000-8000-000000000008';
const matchingRequestId = '60000000-0000-4000-8000-000000000009';
const siteId = '80000000-0000-4000-8000-000000000001';
const foreignEquipmentId = '81000000-0000-4000-8000-000000000009';
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
  equipment_id: null,
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
  callback_due_at: null,
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
      requestRow(matchingRequestId, ORGANIZATION_A, { caller_name: 'Erika Sommer' }),
    ],
    client_request_events: [],
    clients: [
      { id: clientId, organization_id: ORGANIZATION_A, name: 'Bestandskunde' },
      { id: secondClientId, organization_id: ORGANIZATION_A, name: 'Zweiter Kunde' },
      { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' },
      { id: matchingClientId, organization_id: ORGANIZATION_A, name: 'Erika Sommer' },
      // The other organization's customer is the caller of every request here.
      { id: foreignTwinClientId, organization_id: ORGANIZATION_B, name: 'Erika Muster' },
      { id: '70000000-0000-4000-8000-000000000007', organization_id: ORGANIZATION_B, name: 'Erika Sommer' },
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
    // The boiler of the other organization's customer.
    installed_equipment: [{ id: foreignEquipmentId, organization_id: ORGANIZATION_B, site_id: siteId }],
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

// find_client_request_caller_matches as supabase/tests/request_caller_matches.sql
// proves it, reduced to the name: a request outside the passed organization is
// request_not_found, a matched one has no matches, and only the passed
// organization's customers are compared.
const lookUpCallerMatches = (args: Record<string, unknown>): ReturnType<typeof world.rpc> => {
  const request = tableRows(world, 'client_requests').find(
    (row) => row.id === args.p_request_id && row.organization_id === args.p_organization_id,
  );
  if (!request) return { data: null, error: { message: 'request_not_found' } };
  if (request.client_id) return { data: [], error: null };
  const matches = tableRows(world, 'clients')
    .filter(
      (client) => client.organization_id === args.p_organization_id && client.name === request.caller_name,
    )
    .map((client) => ({ client_id: client.id, client_name: client.name, matched_on: ['name'] }));
  return { data: matches, error: null };
};

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
  actions.getCallerMatches(requestId),
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

// The caller match lookup lists only customers of the caller's organization,
// never the other organization's customer with the same name, and asks the
// database with the server-resolved organization only.
world.rpc = ({ name, args }) =>
  name === 'find_client_request_caller_matches'
    ? lookUpCallerMatches(args)
    : { data: null, error: { message: 'unexpected call' } };
world.rpcCalls.length = 0;
assert.deepEqual(await actions.getCallerMatches(matchingRequestId), {
  success: true,
  matches: [{ clientId: matchingClientId, clientName: 'Erika Sommer', matchedOn: ['name'] }],
  moreMatches: false,
});
assert.deepEqual(await actions.getCallerMatches(openRequestId), {
  success: true,
  matches: [],
  moreMatches: false,
});
assert.deepEqual(await actions.getCallerMatches(foreignRequestId), {
  success: false,
  error: 'request_not_found',
});
assert.deepEqual(
  world.rpcCalls.map((call) => call.args.p_organization_id),
  [ORGANIZATION_A, ORGANIZATION_A, ORGANIZATION_A],
);
// A manager of the other organization reaches no request of this one, so no
// customer of either organization through it, and lists only its own customers.
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(await actions.getCallerMatches(matchingRequestId), {
  success: false,
  error: 'request_not_found',
});
assert.deepEqual(await actions.getCallerMatches(foreignRequestId), {
  success: true,
  matches: [{ clientId: foreignTwinClientId, clientName: 'Erika Muster', matchedOn: ['name'] }],
  moreMatches: false,
});
signInAs(world, 'buero');
assert.deepEqual(await actions.getCallerMatches('not-a-uuid'), { success: false, error: 'invalid_input' });
world.rpc = () => ({ data: null, error: { message: 'connection failure' } });
assert.deepEqual(await actions.getCallerMatches(openRequestId), { success: false, error: 'load_failed' });
// One row past the listed matches says that more customers match.
world.rpc = () => ({
  data: Array.from({ length: 11 }, (_, index) => ({
    client_id: `70000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    client_name: `Kunde ${index}`,
    matched_on: ['phone', 'unknown'],
  })),
  error: null,
});
const manyMatches = await actions.getCallerMatches(openRequestId);
assert.ok(manyMatches.success);
assert.equal(manyMatches.matches.length, 10);
assert.equal(manyMatches.moreMatches, true);
assert.deepEqual(manyMatches.matches[0]?.matchedOn, ['phone']);
world.rpc = () => ({ data: null, error: null });

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
      p_callback_due_at: null,
      p_equipment_id: null,
      p_attempt_key: null,
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

// A capture with the Anlage of another organization reaches
// create_client_request with the caller's organization and the Anlage id as
// sent; the stub refuses it as assert_request_equipment does
// (supabase/tests/request_callback_and_equipment.sql). A field worker never
// reaches the database.
const callbackDueAt = '2026-10-01T12:00:00.000Z';
const foreignAnlageCapture = {
  summary: 'Kessel stört',
  clientId,
  siteId,
  equipmentId: foreignEquipmentId,
  callbackDueAt,
};
world.rpcCalls.length = 0;
world.rpc = ({ name, args }) => {
  assert.equal(name, 'create_client_request');
  const equipment = tableRows(world, 'installed_equipment').find(
    (row) => row.id === args.p_equipment_id && row.organization_id === args.p_organization_id,
  );
  return equipment
    ? { data: { ...savedRequest }, error: null }
    : { data: null, error: { message: 'equipment_not_found' } };
};
assert.deepEqual(await actions.createClientRequest(foreignAnlageCapture), {
  success: false,
  error: 'equipment_not_found',
});
assert.deepEqual(world.rpcCalls, [
  {
    name: 'create_client_request',
    args: {
      ...writeArgs,
      p_summary: 'Kessel stört',
      p_details: null,
      p_request_number: null,
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
      p_assigned_to: null,
      p_received_at: null,
      p_callback_due_at: callbackDueAt,
      p_equipment_id: foreignEquipmentId,
      p_attempt_key: null,
    },
  },
]);
// The dialog's attempt key reaches create_client_request as sent, which
// answers a repeated key with its first request
// (supabase/tests/request_retry_results.sql); a key that is no uuid is refused.
const captureKey = '61000000-0000-4000-8000-000000000001';
world.rpcCalls.length = 0;
world.rpc = () => ({ data: { ...savedRequest }, error: null });
for (let press = 0; press < 2; press += 1) {
  const captured = await actions.createClientRequest({ summary: 'Kessel stört' }, captureKey);
  assert.equal(captured.success && captured.request.id, savedRequest.id);
}
assert.deepEqual(
  world.rpcCalls.map(({ args }) => ('p_attempt_key' in args ? args.p_attempt_key : undefined)),
  [captureKey, captureKey],
);
assert.deepEqual(await actions.createClientRequest({ summary: 'Kessel stört' }, 'not-a-uuid'), {
  success: false,
  error: 'invalid_input',
});
assert.deepEqual(await actions.updateClientRequest(openRequestId, { callbackDueAt: 'morgen' }), {
  success: false,
  error: 'invalid_callback_due_at',
});
assert.deepEqual(await actions.createClientRequest({ summary: 'Anfrage', callbackDueAt: 'morgen' }), {
  success: false,
  error: 'invalid_callback_due_at',
});
signInAs(world, 'employee');
world.rpcCalls.length = 0;
assert.deepEqual(await actions.createClientRequest(foreignAnlageCapture), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(world.rpcCalls, []);
signInAs(world, 'buero');
world.rpc = rpcBeforeRequestWrites;
assert.equal(databaseSnapshot(), initialDatabase, 'a refused Anlage writes nothing');

// Promoting an unknown caller is one call of promote_client_request_caller with
// server-resolved values only; the stub applies it as the SQL test proves it.
const promotedRequestId = '60000000-0000-4000-8000-000000000005';
const promotedClientId = '70000000-0000-4000-8000-000000000005';
world.tables.client_requests?.push(requestRow(promotedRequestId, ORGANIZATION_A));
world.rpcCalls.length = 0;
world.rpc = ({ name, args }) => {
  if (name === 'find_client_request_caller_matches') return lookUpCallerMatches(args);
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
const promoteArgs = (requestId: string, name: string, attemptKey: string | null = null) => ({
  name: 'promote_client_request_caller',
  args: {
    p_actor_id: CALLER_ID,
    p_organization_id: ORGANIZATION_A,
    p_request_id: requestId,
    p_name: name,
    p_client_type: 'privat',
    p_attempt_key: attemptKey,
  },
});
const lookupArgs = (requestId: string) => ({
  name: 'find_client_request_caller_matches',
  args: { p_organization_id: ORGANIZATION_A, p_request_id: requestId, p_limit: 11 },
});
assert.deepEqual(world.rpcCalls, [
  lookupArgs(promotedRequestId),
  promoteArgs(promotedRequestId, 'Erika Muster'),
]);
assert.deepEqual(await actions.promoteCallerToClient(promotedRequestId), {
  success: false,
  error: 'already_matched',
});
assert.equal(tableRows(world, 'clients').length, 7);
// A matched request pressed again under an attempt key may be the retry of
// its promotion: it skips the match lookup and goes to
// promote_client_request_caller, which answers its own key with the request
// and refuses another (supabase/tests/request_retry_results.sql).
const promotionKey = '61000000-0000-4000-8000-000000000002';
const promoteCaller = world.rpc;
world.rpcCalls.length = 0;
world.rpc = ({ args }) => ({ data: { ...requestById(String(args.p_request_id)) }, error: null });
const retriedPromotion = await actions.promoteCallerToClient(promotedRequestId, undefined, promotionKey);
assert.equal(retriedPromotion.success && retriedPromotion.request.clientId, promotedClientId);
assert.deepEqual(world.rpcCalls, [promoteArgs(promotedRequestId, 'Erika Muster', promotionKey)]);
assert.equal(tableRows(world, 'clients').length, 7);
world.rpc = promoteCaller;

// A caller who matches a customer is promoted only when the user confirmed
// after seeing the match; an unconfirmed press creates nothing.
world.rpcCalls.length = 0;
assert.deepEqual(await actions.promoteCallerToClient(matchingRequestId), {
  success: false,
  error: 'caller_matches_customer',
});
assert.deepEqual(world.rpcCalls, [lookupArgs(matchingRequestId)]);
assert.equal(tableRows(world, 'clients').length, 7);
world.rpcCalls.length = 0;
const confirmed = await actions.promoteCallerToClient(matchingRequestId, { createDespiteMatches: true });
assert.ok(confirmed.success);
assert.deepEqual(world.rpcCalls, [promoteArgs(matchingRequestId, 'Erika Sommer')]);
// A lookup that cannot complete refuses the unconfirmed promotion.
const unreadRequestId = '60000000-0000-4000-8000-00000000000a';
world.tables.client_requests?.push(requestRow(unreadRequestId, ORGANIZATION_A));
world.rpc = () => ({ data: null, error: { message: 'connection failure' } });
assert.deepEqual(await actions.promoteCallerToClient(unreadRequestId), {
  success: false,
  error: 'load_failed',
});

// A refusal under the database lock keeps its code; any other failure is promote_failed.
const racedRequestId = '60000000-0000-4000-8000-000000000006';
world.tables.client_requests?.push(requestRow(racedRequestId, ORGANIZATION_A));
world.rpc = () => ({ data: null, error: { message: 'already_matched' } });
assert.deepEqual(await actions.promoteCallerToClient(racedRequestId, { createDespiteMatches: true }), {
  success: false,
  error: 'already_matched',
});
world.rpc = () => ({ data: null, error: { message: 'history refused' } });
assert.deepEqual(await actions.promoteCallerToClient(racedRequestId, { createDespiteMatches: true }), {
  success: false,
  error: 'promote_failed',
});
assert.equal(tableRows(world, 'clients').length, 8);

// A conversion is one call of convert_client_request_to_project with
// server-resolved values only; the stub applies the claim and its history row
// as the SQL tests prove them (supabase/tests/work_creation_writes.sql,
// request_retry_results.sql). A converted request answers a retry under the
// conversion's attempt key with its project and refuses any other conversion,
// both before any call.
const convertedProjectId = '90000000-0000-4000-8000-0000000000c1';
const conversionKey = '61000000-0000-4000-8000-000000000003';
world.rpcCalls.length = 0;
world.rpc = ({ name, args }) => {
  if (name !== 'convert_client_request_to_project')
    return { data: null, error: { message: 'unexpected call' } };
  Object.assign(requestById(String(args.p_request_id)), {
    status: 'umgewandelt',
    converted_project_id: convertedProjectId,
    converted_by: args.p_actor_id,
  });
  world.tables.client_request_events?.push({
    organization_id: args.p_organization_id,
    request_id: args.p_request_id,
    event_type: 'converted',
    event_payload: {
      target: 'project',
      projectId: convertedProjectId,
      projectNumber: 'P-2026-001',
      attemptKey: args.p_attempt_key,
    },
  });
  return { data: { id: convertedProjectId, project_number: 'P-2026-001' }, error: null };
};
const converted = await actions.convertRequestToProject(
  openRequestId,
  { name: ' Heizungstausch ', clientId: secondClientId, projectNumber: 'P-2026-001' },
  conversionKey,
);
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
      p_attempt_key: conversionKey,
    },
  },
]);
const retriedConversion = { name: 'Heizungstausch', clientId: secondClientId, projectNumber: 'P-2026-002' };
assert.deepEqual(
  await actions.convertRequestToProject(openRequestId, retriedConversion, conversionKey),
  converted,
);
for (const refused of [
  actions.convertRequestToProject(openRequestId, retriedConversion),
  actions.convertRequestToProject(openRequestId, retriedConversion, '61000000-0000-4000-8000-000000000009'),
  actions.convertRequestToJob(
    openRequestId,
    { title: 'Heizungstausch', clientId: secondClientId },
    conversionKey,
  ),
])
  assert.deepEqual(await refused, { success: false, error: 'already_converted' });
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
