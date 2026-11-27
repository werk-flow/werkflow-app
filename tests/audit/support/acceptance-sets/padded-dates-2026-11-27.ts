import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedCustomer } from '../../../golden/support/db/customers';
import { openRemainingP123Accounts } from '../../../golden/support/db/personnel';
import { seedInstalledEquipment, seedMaintenancePlan } from '../../../golden/support/db/service';
import { seedPublishedWorkTemplate } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#397 of 2026-11-27: every date reads „03.02.2027“,
 * never „3.2.2027“. Each seeded date has a one-digit day and month, so the
 * before and after captures differ where the style changed.
 */
const FIRST_DUE_DATE = '2027-02-03';

async function openedAccount(world: TestWorld): Promise<SurfaceDestination> {
  await openRemainingP123Accounts({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    openedOn: '2026-11-01',
  });
  return { route: '/zeiterfassung/zeitkonto' };
}

async function plannedMaintenance(world: TestWorld): Promise<SurfaceDestination> {
  await surfaceFixture(world, 'acceptance.padded-dates', async () => {
    const actor = { orgId: world.orgId, actorId: world.users.admin.id };
    const site = worldName('Heizzentrale Ahornweg', world.runId);
    const customer = await seedCustomer({
      ...actor,
      name: worldName('Hausverwaltung Ahornweg GmbH', world.runId),
      sites: [{ name: site, street: 'Ahornweg 3', postalCode: '10115', city: 'Berlin', isPrimary: true }],
    });
    const siteId = customer.siteIds.get(site);
    if (!siteId) throw new Error('The padded dates site was not seeded.');
    const template = await seedPublishedWorkTemplate({
      ...actor,
      name: worldName('Jahreswartung Ahornweg', world.runId),
      targetType: 'job',
      items: [{ content: 'Anlage warten' }],
    });
    const equipment = await seedInstalledEquipment({
      ...actor,
      clientId: customer.clientId,
      siteId,
      name: 'Gasbrennwertkessel',
    });
    const plan = await seedMaintenancePlan({
      ...actor,
      clientId: customer.clientId,
      siteId,
      templateVersionId: template.versionId,
      equipmentIds: [equipment.id],
      effectiveFromDate: FIRST_DUE_DATE,
      firstDueDate: FIRST_DUE_DATE,
      intervalMonths: 12,
      businessDate: berlinDateAtOffset(0),
    });
    return plan.planNumber;
  });
  return { route: '/service/wartung' };
}

function paddedDatesCaptures(): OpenSet {
  return {
    id: 'padded-dates-2026-11-27',
    captures: [
      {
        id: 'employee-zeitkonto',
        role: 'employee',
        route: '/zeiterfassung/zeitkonto',
        view: { kind: 'page' },
        destination: openedAccount,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'admin-wartung',
        role: 'admin',
        route: '/service/wartung',
        view: { kind: 'page' },
        destination: plannedMaintenance,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(paddedDatesCaptures());
