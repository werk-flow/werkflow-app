// Actual customer actions over the in-memory database: a field worker creates,
// changes, archives, restores, deletes and opens no customer and lists none of
// its contacts and sites before any database access, even for the customer of
// an own assigned job; a customer or contact of another organization is not
// found, and its row stays as it was. Deleting a linked customer answers what
// links to it.
// Creating a customer lists only likely duplicates of the caller's own
// organization and saves nothing while one matches, unless confirmed.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignClientId = '8d000000-0000-4000-8000-000000000001';
const foreignContactId = '8d000000-0000-4000-8000-000000000002';
const ownClientId = '8d000000-0000-4000-8000-000000000003';
const ownJobId = '8d000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  clients: [
    { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde', phone: '030 4440123' },
    { id: ownClientId, organization_id: ORGANIZATION_A, name: 'Eigener Kunde', phone: '040 5550123' },
  ],
  client_contacts: [
    { id: foreignContactId, organization_id: ORGANIZATION_B, client_id: foreignClientId, name: 'Frau Fremd' },
  ],
  // The caller's own assigned job of an own customer: the assignment still opens no customer list.
  jobs: [
    {
      id: ownJobId,
      organization_id: ORGANIZATION_A,
      client_id: ownClientId,
      'job_assignments.user_id': CALLER_ID,
    },
  ],
});
const {
  archiveClient,
  createClient,
  deleteClient,
  getClientDetail,
  getClientRelations,
  restoreClient,
  updateClient,
  updateClientContact,
} = await import('@/lib/clients/actions');

const managerCalls = [
  ['createClient', () => createClient({ name: 'Neukunde', clientType: 'privat' })],
  ['updateClient', () => updateClient(foreignClientId, { name: 'Umbenannt' })],
  ['deleteClient', () => deleteClient(foreignClientId)],
  ['getClientDetail', () => getClientDetail(foreignClientId)],
  ['updateClientContact', () => updateClientContact(foreignContactId, { name: 'Umbenannt' })],
  ['archiveClient', () => archiveClient(foreignClientId)],
  ['restoreClient', () => restoreClient(foreignClientId)],
] as const;
const relations = [
  ['getClientRelations', () => getClientRelations(ownClientId)],
  ['getClientRelations', () => getClientRelations(foreignClientId)],
] as const;

// Field workers are refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(
  world,
  [...managerCalls, ...relations],
  { success: false, error: 'not_authorized' },
  'none',
);

// Büro does not find another organization's customer or contact.
signInAs(world, 'buero');
await assertRefused(
  world,
  [managerCalls[1], managerCalls[2], managerCalls[5], managerCalls[6]],
  { success: false, error: 'client_not_found' },
  'reads',
);
// The contact is found by update_client_contact inside the caller's organization only.
refuseForeignIds(world, new Map([[foreignContactId, 'contact_not_found']]));
await assertRefused(world, [managerCalls[4]], { success: false, error: 'contact_not_found' }, 'one-call');
await assertRefused(world, [managerCalls[3]], { success: false, error: 'not_found' }, 'reads');
// Another organization's customer lists none of its contacts or sites.
assert.deepEqual(await getClientRelations(foreignClientId), { success: true, contacts: [], sites: [] });

// An own customer with work stays, and the refusal names its links
// (delete_unlinked_client in supabase/tests/client_archive_history.sql).
world.rpc = ({ name, args }) =>
  name === 'delete_unlinked_client' &&
  args.p_client_id === ownClientId &&
  args.p_organization_id === ORGANIZATION_A
    ? { data: { deleted: false, links: { jobs: 1 } }, error: null }
    : { data: null, error: { message: 'unexpected call' } };
const beforeLinkedDelete = JSON.stringify(world.tables);
assert.deepEqual(await deleteClient(ownClientId), {
  success: false,
  error: 'client_has_history',
  links: { jobs: 1 },
});
assert.equal(JSON.stringify(world.tables), beforeLinkedDelete);

// find_client_duplicates as supabase/tests/client_duplicates.sql proves it,
// reduced to an equal phone: only the passed organization's customers compare.
world.rpc = ({ name, args }) =>
  name === 'find_client_duplicates'
    ? {
        data: tableRows(world, 'clients')
          .filter(
            (client) => client.organization_id === args.p_organization_id && client.phone === args.p_phone,
          )
          .map((client) => ({ client_id: client.id, client_name: client.name, matched_on: ['phone'] })),
        error: null,
      }
    : { data: null, error: { message: 'unexpected call' } };
const clientCount = (): number => tableRows(world, 'clients').length;

// The other organization's customer with the same phone is no duplicate: the
// lookup asks with the session's organization only, and the customer saves.
world.rpcCalls.length = 0;
const beforeForeignTwin = clientCount();
const foreignTwin = await createClient({ name: 'Neukundin', clientType: 'privat', phone: '030 4440123' });
assert.ok(foreignTwin.success, JSON.stringify(foreignTwin));
assert.equal(foreignTwin.client.organizationId, ORGANIZATION_A);
assert.equal(clientCount(), beforeForeignTwin + 1);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [['find_client_duplicates', ORGANIZATION_A]],
);

// A customer of the own organization with the same phone holds the first save
// and is listed with its reason; nothing is written.
const beforeOwnTwin = clientCount();
assert.deepEqual(await createClient({ name: 'Neukundin', clientType: 'privat', phone: '040 5550123' }), {
  success: false,
  error: 'possible_duplicates',
  matches: [{ clientId: ownClientId, clientName: 'Eigener Kunde', matchedOn: ['phone'] }],
  moreMatches: false,
});
assert.equal(clientCount(), beforeOwnTwin);

// The confirmed save creates the customer without asking again.
world.rpcCalls.length = 0;
const confirmed = await createClient({ name: 'Neukundin', clientType: 'privat', phone: '040 5550123' }, true);
assert.ok(confirmed.success, JSON.stringify(confirmed));
assert.equal(clientCount(), beforeOwnTwin + 1);
assert.deepEqual(world.rpcCalls, []);

// A failed lookup is no empty one: the save refuses and writes nothing.
world.rpc = () => ({ data: null, error: { message: 'connection failure' } });
const beforeFailedLookup = clientCount();
assert.deepEqual(await createClient({ name: 'Neukundin', clientType: 'privat' }), {
  success: false,
  error: 'load_failed',
});
assert.equal(clientCount(), beforeFailedLookup);

// The other organization's manager sees the twin in its own organization only.
signInAs(world, 'buero', ORGANIZATION_B);
world.rpc = ({ name, args }) =>
  name === 'find_client_duplicates'
    ? {
        data: tableRows(world, 'clients')
          .filter(
            (client) => client.organization_id === args.p_organization_id && client.phone === args.p_phone,
          )
          .map((client) => ({ client_id: client.id, client_name: client.name, matched_on: ['phone'] })),
        error: null,
      }
    : { data: null, error: { message: 'unexpected call' } };
assert.deepEqual(await createClient({ name: 'Neukundin', clientType: 'privat', phone: '030 4440123' }), {
  success: false,
  error: 'possible_duplicates',
  matches: [{ clientId: foreignClientId, clientName: 'Fremder Kunde', matchedOn: ['phone'] }],
  moreMatches: false,
});
