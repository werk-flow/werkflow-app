import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedServiceCase, seedServiceCaseJobLink } from '../../../golden/support/db/service';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedJobAssignment } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { managedBuildingCustomer } from '../managed-buildings';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

/**
 * A job and a Servicefall at the WEG's house, whose Rechnungsempfänger role
 * the Hausverwaltung holds, with an access contact at the house. The job is
 * the employee's and linked to the Servicefall, so its work pack shows what a
 * field worker sees of the same work.
 */
async function seedBilledWork(world: TestWorld): Promise<{ jobNumber: string; caseNumber: string }> {
  const ownerId = (await managedBuildingCustomer(world, 'owner')).clientId;
  const jobNumber = `A-${world.runId}-RECHNUNG`;
  const caseNumber = await surfaceFixture(world, 'acceptance.billed-work', async () => {
    const orgId = world.orgId;
    const actorId = world.users.buero.id;
    const admin = createAdminClient();
    const { data: site } = await admin
      .from('client_sites')
      .select('id')
      .eq('organization_id', orgId)
      .eq('client_id', ownerId)
      .single()
      .throwOnError();
    await admin
      .from('client_contacts')
      .insert({
        organization_id: orgId,
        client_id: ownerId,
        name: 'Karl Hausmeister',
        phone: '0171 5555555',
        site_id: site.id,
        site_role: 'zugangskontakt',
      })
      .throwOnError();
    const jobId = await seedJob({
      orgId,
      actorId,
      jobNumber,
      title: worldName('Heizung entlüften Lindenstraße 5', world.runId),
      clientId: ownerId,
      siteId: site.id,
    });
    await seedJobAssignment({ orgId, actorId, jobId, userId: world.users.employee.id });
    const serviceCase = await seedServiceCase({
      orgId,
      actorId,
      clientId: ownerId,
      siteId: site.id,
      summary: worldName('Therme im Keller tropft', world.runId),
      statement: 'Unter der Therme steht Wasser.',
    });
    await seedServiceCaseJobLink({ orgId, actorId, serviceCaseId: serviceCase.id, jobId });
    return serviceCase.caseNumber;
  });
  return { jobNumber, caseNumber };
}

async function billedJob(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/auftraege/${encodeURIComponent((await seedBilledWork(world)).jobNumber)}` };
}

async function billedServiceCase(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/service/faelle/${encodeURIComponent((await seedBilledWork(world)).caseNumber)}` };
}

/**
 * werk-flow/werkflow-planning#327 of 2026-11-12: the Auftraggeber, the frozen
 * Rechnungsempfänger, the Einsatzort and its access contact on a job and a
 * Servicefall for the Büro; the same job's work pack for the employee, which
 * shows no recipient; the request's Details rows and the choice dialog.
 */
function billingPartyCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'billing-parties-2026-11-12',
    captures: [
      {
        id: 'buero-auftrag',
        role: 'buero',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: billedJob,
        reveal: 'Auftraggeber und Rechnung',
        ...both,
      },
      {
        id: 'employee-auftrag',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: billedJob,
        ...both,
      },
      {
        id: 'buero-servicefall',
        role: 'buero',
        route: '/service/faelle/[caseNumber]',
        view: { kind: 'page' },
        destination: billedServiceCase,
        reveal: 'Auftraggeber und Rechnung',
        ...both,
      },
      { id: 'buero-anfrage', role: 'buero', route: '/anfragen/[requestId]', view: { kind: 'page' }, ...both },
      {
        id: 'buero-anfrage-rechnung-dialog',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'dialog', opener: 'requests.billing-parties' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(billingPartyCaptures());
