import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../../golden/support/db/customers';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * An archived customer whose name, phone and contact email changed through
 * the write functions, so the chronology lists master-data entries.
 */
async function archivedCustomerId(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'acceptance.archived-customer', async () => {
    const actor = world.users.buero.id;
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: actor,
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      contacts: [{ name: 'Erika Musterfrau', phone: '030 1111111', isPrimary: true }],
    });
    const admin = createAdminClient();
    await admin
      .rpc('update_client_master', {
        p_actor_id: actor,
        p_organization_id: world.orgId,
        p_client_id: customer.clientId,
        p_changes: { phone: '030 2222222', client_type: 'gewerblich' },
      })
      .throwOnError();
    await admin
      .rpc('set_client_archived', {
        p_actor_id: actor,
        p_organization_id: world.orgId,
        p_client_id: customer.clientId,
        p_archived: true,
      })
      .throwOnError();
    return customer.clientId;
  });
}

async function archivedCustomer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden/${await archivedCustomerId(world)}` };
}

async function archivedCustomerList(world: TestWorld): Promise<SurfaceDestination> {
  await archivedCustomerId(world);
  return { route: '/kunden?ansicht=archiviert' };
}

/**
 * werk-flow/werkflow-planning#325 of 2026-11-09: the list's view select, the
 * archive and delete dialogs, the archived customer list, and an archived
 * customer's notice and master-data entries in the chronology.
 */
function customerArchiveCaptures(): OpenSet {
  const both = { role: 'buero', widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'customer-archive-2026-11-09',
    captures: [
      { id: 'buero-kunden', route: '/kunden', view: { kind: 'page' }, ...both },
      {
        id: 'buero-kunden-dialog-customers-list-archive',
        route: '/kunden',
        view: { kind: 'dialog', opener: 'customers.list-archive' },
        ...both,
      },
      {
        id: 'buero-kunden-clientId-dialog-customers-delete',
        route: '/kunden/[clientId]',
        view: { kind: 'dialog', opener: 'customers.delete' },
        ...both,
      },
      {
        id: 'buero-kunden-archiviert',
        route: '/kunden',
        view: { kind: 'page' },
        destination: archivedCustomerList,
        ...both,
      },
      {
        id: 'buero-kunde-archiviert',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        destination: archivedCustomer,
        ...both,
      },
      {
        id: 'buero-kunde-archiviert-verlauf',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        destination: archivedCustomer,
        reveal: 'Stammdaten geändert',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(customerArchiveCaptures());
