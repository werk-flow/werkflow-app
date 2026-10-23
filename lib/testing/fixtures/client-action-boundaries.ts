// Actual customer actions over the in-memory database: a field worker creates,
// changes, deletes and opens no customer before any database access and reads
// a customer's contacts and sites only through an own assigned job; a
// customer or contact of another organization is not found, and its row stays as it was.
import assert from 'node:assert/strict';
import { ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const foreignClientId = '8d000000-0000-4000-8000-000000000001';
const foreignContactId = '8d000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  clients: [{ id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' }],
  client_contacts: [
    { id: foreignContactId, organization_id: ORGANIZATION_B, client_id: foreignClientId, name: 'Frau Fremd' },
  ],
  jobs: [],
});
const { createClient, updateClient, deleteClient, getClientDetail, updateClientContact, getClientRelations } =
  await import('@/lib/clients/actions');

const managerCalls = [
  ['createClient', () => createClient({ name: 'Neukunde', clientType: 'privat' })],
  ['updateClient', () => updateClient(foreignClientId, { name: 'Umbenannt' })],
  ['deleteClient', () => deleteClient(foreignClientId)],
  ['getClientDetail', () => getClientDetail(foreignClientId)],
  ['updateClientContact', () => updateClientContact(foreignContactId, { name: 'Umbenannt' })],
] as const;
const relations = ['getClientRelations', () => getClientRelations(foreignClientId)] as const;

// Field workers are refused before the service-role client exists, and a
// customer without an own assigned job (here: another organization's) after the job read.
signInAs(world, 'employee');
await assertRefused(world, managerCalls, { success: false, error: 'not_authorized' }, 'none');
await assertRefused(world, [relations], { success: false, error: 'not_authorized' }, 'reads');

// Büro does not find another organization's customer or contact.
signInAs(world, 'buero');
await assertRefused(
  world,
  [managerCalls[1], managerCalls[2]],
  { success: false, error: 'client_not_found' },
  'reads',
);
await assertRefused(world, [managerCalls[4]], { success: false, error: 'contact_not_found' }, 'reads');
await assertRefused(world, [managerCalls[3]], { success: false, error: 'not_found' }, 'reads');
// Another organization's customer lists none of its contacts or sites.
assert.deepEqual(await getClientRelations(foreignClientId), { success: true, contacts: [], sites: [] });
