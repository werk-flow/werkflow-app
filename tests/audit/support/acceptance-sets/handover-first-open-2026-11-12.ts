import { randomUUID } from 'node:crypto';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../../golden/support/db/customers';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJobAssignment } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** A finished service job without any evidence, whose handover was never opened. */
async function handoverWithoutEvidence(world: TestWorld): Promise<SurfaceDestination> {
  const jobNumber = `UEB-163-${world.runId}`;
  const title = worldName('Thermostat tauschen', world.runId);
  await surfaceFixture(world, 'acceptance.handover-without-evidence', async () => {
    await createAdminClient()
      .from('jobs')
      .insert({
        id: randomUUID(),
        organization_id: world.orgId,
        created_by: world.users.admin.id,
        job_number: jobNumber,
        title,
        execution_state: 'execution_complete' as const,
      })
      .throwOnError();
    return jobNumber;
  });
  return { route: `/auftraege/${jobNumber}/uebergabe`, heading: title };
}

/** The employee's work pack for a private customer who is their own contact. */
async function workPackOwnContact(world: TestWorld): Promise<SurfaceDestination> {
  const jobNumber = `KON-163-${world.runId}`;
  const title = worldName('Heizkörper entlüften', world.runId);
  await surfaceFixture(world, 'acceptance.work-pack-own-contact', async () => {
    const customerName = worldName('Erika Sommer', world.runId);
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customerName,
      contacts: [{ name: customerName, role: 'Eigentümer/in', isPrimary: true }],
    });
    const jobId = randomUUID();
    await createAdminClient()
      .from('jobs')
      .insert({
        id: jobId,
        organization_id: world.orgId,
        created_by: world.users.admin.id,
        job_number: jobNumber,
        title,
        client_id: customer.clientId,
        contact_id: customer.contactIds.get(customerName) ?? null,
      })
      .throwOnError();
    await seedJobAssignment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobId,
      userId: world.users.employee.id,
    });
    return jobNumber;
  });
  return { route: `/auftraege/${jobNumber}`, heading: title };
}

/**
 * werk-flow/werkflow-planning#163 of 2026-11-12: the handover review of a job
 * without evidence opens with its checks, the Übergabevermerk and the release,
 * and names the next step; the job edit dialog opens on the title; the work
 * pack names a customer who is their own contact once.
 */
function handoverFirstOpenCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'handover-first-open-2026-11-12',
    captures: [
      {
        id: 'buero-auftraege-jobNumber-uebergabe',
        role: 'buero',
        route: '/auftraege/[jobNumber]/uebergabe',
        view: { kind: 'page' },
        destination: handoverWithoutEvidence,
        ...both,
      },
      {
        id: 'admin-auftraege-jobNumber-dialog-work-edit-job',
        role: 'admin',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'dialog', opener: 'work.edit-job' },
        widths: [1280],
        schemes: ['light'],
      },
      {
        id: 'employee-auftraege-jobNumber',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: workPackOwnContact,
        reveal: 'Kontakt',
        widths: [375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(handoverFirstOpenCaptures());
