import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedInstalledEquipment, seedMaintenancePlan } from '../../../golden/support/db/service';
import { seedPublishedWorkTemplate } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** One Wartung overdue for ten days and one due in five, each on its own Anlage of one Einsatzort. */
const DUE = [
  { equipment: 'Gasbrennwertkessel', offsetDays: -10 },
  { equipment: 'Enthärtungsanlage', offsetDays: 5 },
] as const;

/** Admin's and Büro's open work with due maintenance in its lead time. */
function withDueMaintenance(route: string) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    await surfaceFixture(world, 'acceptance.due-maintenance', async () => {
      const actor = { orgId: world.orgId, actorId: world.users.admin.id };
      const site = worldName('Heizzentrale Lindenhof', world.runId);
      const customer = await seedCustomer({
        ...actor,
        name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
        sites: [{ name: site, street: 'Lindenhof 4', postalCode: '10115', city: 'Berlin', isPrimary: true }],
      });
      const siteId = customer.siteIds.get(site);
      if (!siteId) throw new Error('The due maintenance site was not seeded.');
      const template = await seedPublishedWorkTemplate({
        ...actor,
        name: worldName('Jahreswartung', world.runId),
        targetType: 'job',
        items: [{ content: 'Anlage warten' }],
      });
      // The plan numbers, so a later capture in the same world finds the seed done.
      const planNumbers: string[] = [];
      for (const due of DUE) {
        const equipment = await seedInstalledEquipment({
          ...actor,
          clientId: customer.clientId,
          siteId,
          name: due.equipment,
        });
        const firstDueDate = berlinDateAtOffset(due.offsetDays);
        const plan = await seedMaintenancePlan({
          ...actor,
          clientId: customer.clientId,
          siteId,
          templateVersionId: template.versionId,
          equipmentIds: [equipment.id],
          effectiveFromDate: firstDueDate,
          firstDueDate,
          intervalMonths: 12,
          businessDate: berlinDateAtOffset(0),
        });
        planNumbers.push(plan.planNumber);
      }
      return planNumbers.join(',');
    });
    return { route, heading: route === '/aufgaben' ? 'Aufgaben' : 'Dashboard' };
  };
}

/**
 * werk-flow/werkflow-planning#518 of 2026-11-26: due and overdue maintenance
 * is the Aufgaben section „Fällige Wartungen“ for Admin and Büro, and the
 * office and owner starts show it like every other section instead of their
 * separate overdue count. A field worker's Aufgaben shows none of it.
 */
function dueMaintenanceCaptures(): OpenSet {
  return {
    id: 'due-maintenance-2026-11-26',
    captures: [
      {
        id: 'admin-aufgaben',
        role: 'admin',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: withDueMaintenance('/aufgaben'),
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'buero-dashboard',
        role: 'buero',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: withDueMaintenance('/dashboard'),
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'admin-dashboard',
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: withDueMaintenance('/dashboard'),
        widths: [1280],
        schemes: ['light'],
      },
      {
        id: 'employee-aufgaben',
        role: 'employee',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: withDueMaintenance('/aufgaben'),
        widths: [375],
        schemes: ['light'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(dueMaintenanceCaptures());
