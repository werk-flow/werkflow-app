// Actual Einsatzort role actions over the in-memory database: a field worker
// records, ends and reads no role before any database access; a manager
// cannot reach another organization's customer, Einsatzort, holder or role,
// and a refused call writes nothing. The database function's own refusals
// are proven by supabase/tests/client_site_roles.sql.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownClientId = '8e000000-0000-4000-8000-000000000001';
const ownSiteId = '8e000000-0000-4000-8000-000000000002';
const foreignClientId = '8e000000-0000-4000-8000-000000000009';
const foreignSiteId = '8e000000-0000-4000-8000-00000000000a';
const foreignRoleId = '8e000000-0000-4000-8000-00000000000b';

const world = installActionWorld({
  clients: [
    { id: ownClientId, organization_id: ORGANIZATION_A, name: 'Hausverwaltung Lindenhof GmbH' },
    { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremde Verwaltung' },
  ],
  client_sites: [
    { id: ownSiteId, organization_id: ORGANIZATION_A, client_id: ownClientId, name: 'Haus Lindenstraße' },
    { id: foreignSiteId, organization_id: ORGANIZATION_B, client_id: foreignClientId, name: 'Fremdes Haus' },
  ],
});
const { assignClientSiteRole, endClientSiteRole, getClientSiteRoles } = await import(
  '@/lib/clients/site-role-actions'
);

const assign = (siteId: string, holderClientId: string) => () =>
  assignClientSiteRole({
    siteId,
    role: 'hausverwaltung',
    holderClientId,
    startsOn: null,
    replacesRoleId: null,
  });
const end = (roleId: string) => () => endClientSiteRole({ roleId, endsOn: '2026-06-30' });

// Field workers are refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['assignClientSiteRole', assign(ownSiteId, ownClientId)],
    ['endClientSiteRole', end(foreignRoleId)],
    ['getClientSiteRoles', () => getClientSiteRoles(ownClientId)],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// A manager reads no role of another organization's customer.
signInAs(world, 'buero');
await assertRefused(
  world,
  [['getClientSiteRoles', () => getClientSiteRoles(foreignClientId)]],
  { success: false, error: 'client_not_found' },
  'reads',
);

// The one database call refuses a foreign Einsatzort, holder or role with the
// code the real function raises; the action passes the caller's organization.
refuseForeignIds(
  world,
  new Map([
    [foreignSiteId, 'site_not_found'],
    [foreignClientId, 'holder_not_found'],
    [foreignRoleId, 'role_not_found'],
  ]),
);
await assertRefused(
  world,
  [['assignClientSiteRole', assign(foreignSiteId, ownClientId)]],
  { success: false, error: 'site_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['assignClientSiteRole', assign(ownSiteId, foreignClientId)]],
  { success: false, error: 'holder_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['endClientSiteRole', end(foreignRoleId)]],
  { success: false, error: 'role_not_found' },
  'one-call',
);
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);

// Malformed input never reaches the database: a change without its day, or
// a day the calendar does not have.
await assertRefused(
  world,
  [
    [
      'assignClientSiteRole',
      () =>
        assignClientSiteRole({
          siteId: ownSiteId,
          role: 'hausverwaltung',
          holderClientId: ownClientId,
          startsOn: null,
          replacesRoleId: foreignRoleId,
        }),
    ],
    [
      'assignClientSiteRole',
      () =>
        assignClientSiteRole({
          siteId: ownSiteId,
          role: 'hausverwaltung',
          holderClientId: ownClientId,
          startsOn: '2026-02-30',
          replacesRoleId: null,
        }),
    ],
    ['endClientSiteRole', () => endClientSiteRole({ roleId: foreignRoleId, endsOn: '2026-02-30' })],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
