// The actual conversion of a request into an offer over the in-memory
// database: only managers pass, the organization and actor come from the
// session, a Büro member who sends another organization's request converts
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
const foreignRequestId = '60000000-0000-4000-8000-000000000009';
const siteId = '71000000-0000-4000-8000-000000000001';
const offerId = '93000000-0000-4000-8000-000000000001';
const attemptKey = '91000000-0000-4000-8000-000000000001';

const world = installActionWorld({
  client_requests: [
    { id: requestId, organization_id: ORGANIZATION_A, client_id: '70000000-0000-4000-8000-000000000001' },
    {
      id: foreignRequestId,
      organization_id: ORGANIZATION_B,
      client_id: '70000000-0000-4000-8000-000000000009',
    },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' }],
});
const { convertRequestToOffer } = await import('@/lib/requests/offer-conversion-actions');

// convert_client_request_to_offer as supabase/tests/request_retry_results.sql
// proves it, reduced to the organization: a request outside the passed
// organization is not found.
world.rpc = ({ name, args }) => {
  assert.equal(name, 'convert_client_request_to_offer');
  const request = tableRows(world, 'client_requests').find(
    (row) => row.id === args.p_request_id && row.organization_id === args.p_organization_id,
  );
  return request
    ? { data: { id: offerId, offer_number: 'ANG-2026-001' }, error: null }
    : { data: null, error: { message: 'request_not_found' } };
};
const convertArgs = (convertedRequestId: string, organizationId: string) => ({
  name: 'convert_client_request_to_offer',
  args: {
    p_organization_id: organizationId,
    p_actor_id: CALLER_ID,
    p_request_id: convertedRequestId,
    p_attempt_key: attemptKey,
    p_title: 'Badsanierung',
    p_site_id: siteId,
    p_contact_id: null,
  },
});
const convert = (convertedRequestId: string) =>
  convertRequestToOffer(convertedRequestId, { title: 'Badsanierung', siteId, contactId: '' }, attemptKey);

// Signed-out callers, callers without an organization and field workers convert nothing.
world.callerId = null;
assert.deepEqual(await convert(requestId), { success: false, error: 'not_authenticated' });
signInAs(world, null);
assert.deepEqual(await convert(requestId), { success: false, error: 'no_active_org' });
signInAs(world, 'employee');
assert.deepEqual(await convert(requestId), { success: false, error: 'not_authorized' });
assert.deepEqual(world.rpcCalls, []);

// A Büro member who sends another organization's request converts nothing;
// the own request converts with the session's organization and actor.
signInAs(world, 'buero');
assert.deepEqual(await convert(foreignRequestId), { success: false, error: 'request_not_found' });
assert.deepEqual(await convert(requestId), { success: true, offerId, offerNumber: 'ANG-2026-001' });
assert.deepEqual(world.rpcCalls, [
  convertArgs(foreignRequestId, ORGANIZATION_A),
  convertArgs(requestId, ORGANIZATION_A),
]);

// A Büro member of the other organization reaches no request of this one.
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(await convert(requestId), { success: false, error: 'request_not_found' });
signInAs(world, 'buero');

// Without a valid request id, attempt key, Objekt or title nothing reaches the database.
world.rpcCalls.length = 0;
for (const [id, input, key] of [
  ['not-a-uuid', { title: 'Bad' }, attemptKey],
  [requestId, { title: 'Bad' }, 'not-a-uuid'],
  [requestId, { title: 'Bad', siteId: 'not-a-uuid' }, attemptKey],
  [requestId, { title: 'x'.repeat(201) }, attemptKey],
] as const) {
  assert.deepEqual(await convertRequestToOffer(id, input, key), { success: false, error: 'invalid_input' });
}
assert.deepEqual(world.rpcCalls, []);

// The function's refusals keep their codes; any other failure is create_failed.
for (const refusal of ['already_converted', 'client_required', 'title_required', 'site_not_found']) {
  world.rpc = () => ({ data: null, error: { message: refusal } });
  assert.deepEqual(await convert(requestId), { success: false, error: refusal });
}
world.rpc = () => ({ data: null, error: { message: 'connection failure' } });
assert.deepEqual(await convert(requestId), { success: false, error: 'create_failed' });
