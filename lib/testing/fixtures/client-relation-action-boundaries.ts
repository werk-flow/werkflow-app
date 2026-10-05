// Actual contact and work-site actions over the in-memory database: only
// managers pass, a customer, contact or site of another organization is
// unreachable, and saving a primary row writes that row alone. Clearing the
// previous primary is the database's job (supabase/tests/customer_atomic_writes.sql).
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const clientId = '71000000-0000-4000-8000-000000000001';
const foreignClientId = '71000000-0000-4000-8000-000000000009';
const primaryContactId = '72000000-0000-4000-8000-000000000001';
const foreignContactId = '72000000-0000-4000-8000-000000000009';
const primarySiteId = '73000000-0000-4000-8000-000000000001';
const foreignSiteId = '73000000-0000-4000-8000-000000000009';
const now = '2026-10-01T08:00:00.000Z';

const contactRow = (id: string, organizationId: string, owner: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  client_id: owner,
  name: 'Bestehend',
  role: null,
  email: null,
  phone: null,
  notes: null,
  is_primary: true,
  is_active: true,
  created_by: null,
  created_at: now,
  updated_at: now,
});
const siteRow = (id: string, organizationId: string, owner: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  client_id: owner,
  name: 'Heizraum',
  street: null,
  postal_code: null,
  city: null,
  access_notes: null,
  notes: null,
  primary_contact_id: null,
  is_primary: true,
  is_active: true,
  created_by: null,
  created_at: now,
  updated_at: now,
});

const world = installActionWorld(
  {
    clients: [
      { id: clientId, organization_id: ORGANIZATION_A, name: 'Kunde' },
      { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' },
    ],
    client_contacts: [
      contactRow(primaryContactId, ORGANIZATION_A, clientId),
      contactRow(foreignContactId, ORGANIZATION_B, foreignClientId),
    ],
    client_sites: [
      siteRow(primarySiteId, ORGANIZATION_A, clientId),
      siteRow(foreignSiteId, ORGANIZATION_B, foreignClientId),
    ],
  },
  {
    client_contacts: () => ({ is_active: true, created_at: now, updated_at: now }),
    client_sites: () => ({ is_active: true, created_at: now, updated_at: now }),
  },
);
const actions = await import('@/lib/clients/actions');

const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();

const everyAction = (
  owner: string,
  contactId: string,
  siteId: string,
): Array<Promise<{ success: boolean; error?: string }>> => [
  actions.createClientContact(owner, { name: 'Neu', isPrimary: true }),
  actions.updateClientContact(contactId, { isPrimary: true }),
  actions.createClientSite(owner, { name: 'Neu', isPrimary: true }),
  actions.updateClientSite(siteId, { isPrimary: true }),
];

// Field workers are denied before the database is touched.
signInAs(world, 'employee');
for (const result of await Promise.all(everyAction(clientId, primaryContactId, primarySiteId)))
  assert.deepEqual(result, { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, 0);

// A manager cannot reach a customer, contact or site of another organization.
signInAs(world, 'buero');
assert.deepEqual(await Promise.all(everyAction(foreignClientId, foreignContactId, foreignSiteId)), [
  { success: false, error: 'client_not_found' },
  { success: false, error: 'contact_not_found' },
  { success: false, error: 'client_not_found' },
  { success: false, error: 'site_not_found' },
]);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied or rejected call may write');

// A new primary contact and site are one insert each; the action itself never
// rewrites the previous primary row.
const contact = await actions.createClientContact(clientId, { name: 'Neue Hauptperson', isPrimary: true });
assert.ok(contact.success);
assert.deepEqual([contact.contact.organizationId, contact.contact.isPrimary], [ORGANIZATION_A, true]);
const site = await actions.createClientSite(clientId, { name: 'Neuer Hauptort', isPrimary: true });
assert.ok(site.success);
assert.deepEqual([site.site.organizationId, site.site.isPrimary], [ORGANIZATION_A, true]);
assert.deepEqual(
  tableRows(world, 'client_contacts').find((row) => row.id === primaryContactId),
  contactRow(primaryContactId, ORGANIZATION_A, clientId),
);
assert.deepEqual(
  tableRows(world, 'client_sites').find((row) => row.id === primarySiteId),
  siteRow(primarySiteId, ORGANIZATION_A, clientId),
);

// Marking an existing row primary changes that row alone.
const marked = await actions.updateClientSite(primarySiteId, { isPrimary: true });
assert.ok(marked.success);
assert.deepEqual(
  tableRows(world, 'client_sites')
    .filter((row) => row.is_primary)
    .map((row) => row.id),
  [primarySiteId, foreignSiteId, site.site.id],
);

// Nothing above touched the other organization.
assert.deepEqual(
  tableRows(world, 'client_contacts').find((row) => row.id === foreignContactId),
  contactRow(foreignContactId, ORGANIZATION_B, foreignClientId),
);
assert.deepEqual(
  tableRows(world, 'client_sites').find((row) => row.id === foreignSiteId),
  siteRow(foreignSiteId, ORGANIZATION_B, foreignClientId),
);
