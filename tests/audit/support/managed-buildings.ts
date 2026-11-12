import { worldName } from '../../../lib/testing/seed-world-plan';
import { getObjektCustomer, seedCustomer, type PersistedCustomer } from '../../golden/support/db/customers';
import { seedInstalledEquipment } from '../../golden/support/db/service';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';
import { surfaceFixture } from './surface-fixtures';

// The Objekt-role world of the site-roles acceptance set, also opened by the
// customers layout audit: it lives apart from the set file, which only the
// acceptance loader may load. Each consumer builds its own route.

/**
 * A Hausverwaltung managing two buildings of other customers: a WEG's house
 * with two tenants and an Anlage, which it took over from a former
 * Hausverwaltung and receives the invoices for, and a private owner's house
 * with an access contact. Every write goes through the functions the
 * actions call, so the history shows them.
 */
export async function seedManagedBuildings(world: TestWorld): Promise<void> {
  const sourcePrefix = managedBuildingsSourcePrefix(world);
  await surfaceFixture(world, 'acceptance.managed-buildings', async () => {
    const orgId = world.orgId;
    const actor = world.users.buero.id;
    const admin = createAdminClient();
    const manager = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      contacts: [
        { name: 'Erika Musterfrau', role: 'Objektbetreuung', phone: '030 1111111', isPrimary: true },
      ],
    });
    const former = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('Hausverwaltung Birkenhain GmbH', world.runId),
    });
    const owner = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('WEG Lindenstraße 5', world.runId),
      contacts: [
        { name: 'Max Mustermann', phone: '0171 2222222' },
        { name: 'Lena Beispiel', phone: '0171 3333333' },
      ],
      sites: [
        {
          name: 'Haus Lindenstraße 5',
          street: 'Lindenstraße 5',
          postalCode: '10115',
          city: 'Berlin',
          isPrimary: true,
        },
      ],
    });
    const privateOwner = await seedCustomer({
      orgId,
      actorId: actor,
      name: worldName('Jonas Beispielmann', world.runId),
      contacts: [{ name: 'Petra Zugang', phone: '0171 4444444' }],
      sites: [
        {
          name: 'Mehrfamilienhaus Birkenweg 2',
          street: 'Birkenweg 2',
          postalCode: '10117',
          city: 'Berlin',
          isPrimary: true,
        },
      ],
    });
    const ownerSite = owner.siteIds.get('Haus Lindenstraße 5');
    const privateSite = privateOwner.siteIds.get('Mehrfamilienhaus Birkenweg 2');
    if (!ownerSite || !privateSite) throw new Error('managedBuildings: a seeded site is missing.');

    const site = async (siteId: string, sourceNumber: string): Promise<void> => {
      await admin
        .rpc('update_client_site', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_site_id: siteId,
          p_changes: { source_number: sourceNumber },
        })
        .throwOnError();
    };
    await site(ownerSite, `${sourcePrefix}-1`);
    await site(privateSite, `${sourcePrefix}-2`);
    const link = async (
      contacts: ReadonlyMap<string, string>,
      name: string,
      siteId: string,
      siteRole: 'mieter' | 'zugangskontakt',
    ): Promise<void> => {
      const contactId = contacts.get(name);
      if (!contactId) throw new Error(`managedBuildings: contact ${name} is missing.`);
      await admin
        .rpc('update_client_contact', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_contact_id: contactId,
          p_changes: { site_id: siteId, site_role: siteRole },
        })
        .throwOnError();
    };
    await link(owner.contactIds, 'Max Mustermann', ownerSite, 'mieter');
    await link(owner.contactIds, 'Lena Beispiel', ownerSite, 'mieter');
    await link(privateOwner.contactIds, 'Petra Zugang', privateSite, 'zugangskontakt');

    const role = async (
      siteId: string,
      kind: 'eigentuemer' | 'hausverwaltung' | 'rechnungsempfaenger',
      holderId: string,
      startsOn: string | null,
      replacedRoleId?: string,
    ): Promise<string> => {
      const { data } = await admin
        .rpc('assign_client_site_role', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_site_id: siteId,
          p_role: kind,
          p_holder_client_id: holderId,
          ...(replacedRoleId ? { p_replaced_role_id: replacedRoleId } : {}),
          ...(startsOn ? { p_starts_on: startsOn } : {}),
        })
        .throwOnError();
      return data.id;
    };
    await role(ownerSite, 'eigentuemer', owner.clientId, null);
    const formerManagement = await role(ownerSite, 'hausverwaltung', former.clientId, '2019-01-01');
    await role(ownerSite, 'hausverwaltung', manager.clientId, '2025-01-01', formerManagement);
    await role(ownerSite, 'rechnungsempfaenger', manager.clientId, '2025-01-01');
    await role(privateSite, 'eigentuemer', privateOwner.clientId, null);
    await role(privateSite, 'hausverwaltung', manager.clientId, '2023-07-01');
    await seedInstalledEquipment({
      orgId,
      actorId: actor,
      clientId: owner.clientId,
      siteId: ownerSite,
      name: 'Gasbrennwerttherme Keller',
    });
    return 'seeded';
  });
}

/** The Objekt numbers of the two buildings start with this prefix. */
export function managedBuildingsSourcePrefix(world: TestWorld): string {
  return `OBJ-${world.runId.slice(0, 6)}`;
}

/**
 * The Hausverwaltung (`manager`) or the WEG (`owner`) of the first building,
 * seeded once and read back by its Objekt number: another set seeds a
 * customer of the same name in the world.
 */
export async function managedBuildingCustomer(
  world: TestWorld,
  which: 'manager' | 'owner',
): Promise<PersistedCustomer> {
  await seedManagedBuildings(world);
  const sourceNumber = `${managedBuildingsSourcePrefix(world)}-1`;
  return getObjektCustomer(world.orgId, sourceNumber, which === 'manager' ? 'hausverwaltung' : undefined);
}
