// Actual contact and work-site actions over the in-memory database: only
// managers pass, a customer, contact or site of another organization is
// unreachable, a contact email is one address or blank, and saving a primary
// row writes that row alone. Clearing the previous primary is the database's
// job (supabase/tests/customer_atomic_writes.sql).
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
// update_client_contact and update_client_site as
// supabase/tests/client_archive_history.sql proves them, reduced to the
// organization scope: a row of another organization is not found and stays.
world.rpc = ({ name, args }) => {
  const target =
    name === 'update_client_contact'
      ? { table: 'client_contacts', id: args.p_contact_id, missing: 'contact_not_found' }
      : name === 'update_client_site'
        ? { table: 'client_sites', id: args.p_site_id, missing: 'site_not_found' }
        : null;
  if (!target) return { data: null, error: { message: 'unexpected call' } };
  const row = tableRows(world, target.table).find(
    (candidate) => candidate.id === target.id && candidate.organization_id === args.p_organization_id,
  );
  if (!row) return { data: null, error: { code: 'P0001', message: target.missing } };
  const changes = args.p_changes;
  if (typeof changes === 'object' && changes !== null) Object.assign(row, changes);
  return { data: row, error: null };
};
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

// A contact email is one address or blank: any other text is refused on
// create and update, for an own and a foreign record alike, before any read.
const requestsBeforeEmails = world.adminClientRequests;
for (const email of [
  'erste@example.de, zweite@example.de',
  'name@example.de?x',
  'name@example.de&x',
  'name@example.de%0A',
  'kein Postfach',
]) {
  for (const [owner, contactId] of [
    [clientId, primaryContactId],
    [foreignClientId, foreignContactId],
  ] as const) {
    assert.deepEqual(
      await actions.createClientContact(owner, { name: 'Neu', email }),
      { success: false, error: 'invalid_input' },
      `create refuses ${email}`,
    );
    assert.deepEqual(
      await actions.updateClientContact(contactId, { email }),
      { success: false, error: 'invalid_input' },
      `update refuses ${email}`,
    );
  }
}
assert.equal(
  world.adminClientRequests,
  requestsBeforeEmails,
  'a malformed email is refused before the database',
);
// A well-formed email does not open another organization's contact.
assert.deepEqual(await actions.updateClientContact(foreignContactId, { email: 'kunde@example.de' }), {
  success: false,
  error: 'contact_not_found',
});
assert.equal(databaseSnapshot(), initialDatabase, 'no refused email may write');

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

// A well-formed email is saved trimmed, and a blank one clears it.
const withEmail = await actions.createClientContact(clientId, {
  name: 'Mit E-Mail',
  email: ' kunde@example.de ',
});
assert.ok(withEmail.success);
assert.equal(withEmail.contact.email, 'kunde@example.de');
const cleared = await actions.updateClientContact(withEmail.contact.id, { email: '  ' });
assert.ok(cleared.success);
assert.equal(cleared.contact.email, null);
