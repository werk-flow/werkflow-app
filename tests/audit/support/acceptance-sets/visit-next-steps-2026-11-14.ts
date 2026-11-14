import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../../golden/support/db/customers';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

/**
 * The admin's follow-up that a visit ending not done with a Rückkehr gives its
 * owner: the title and the visit job source the completion writes.
 */
async function aufgabenWithReturnStep(world: TestWorld): Promise<SurfaceDestination> {
  await surfaceFixture(world, 'acceptance.visit-next-step', async () => {
    const orgId = world.orgId;
    const actorId = world.users.admin.id;
    const customer = await seedCustomer({
      orgId,
      actorId,
      name: worldName('Hausverwaltung Lindenhof', world.runId),
    });
    const jobNumber = `A-${world.runId}-WARTUNG`;
    const jobId = await seedJob({
      orgId,
      actorId,
      jobNumber,
      title: 'Wartungsbesuch',
      clientId: customer.clientId,
    });
    await createAdminClient()
      .from('client_follow_ups')
      .insert({
        organization_id: orgId,
        client_id: customer.clientId,
        source_type: 'job',
        source_id: jobId,
        title: `Rückkehr einplanen · WPL-${world.runId} · ${jobNumber}`,
        note: 'Offene Mängel: Umwälzpumpe läuft nicht an',
        owner_user_id: actorId,
        due_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: actorId,
        updated_by: actorId,
      })
      .throwOnError();
    return jobNumber;
  });
  return { route: '/aufgaben' };
}

/**
 * werk-flow/werkflow-planning#470 of 2026-11-14: „Wartung abschließen“ for a
 * visit not done, with its Mängel, next step, owner and target date, and the
 * owner's next step in Aufgaben. Before: the committed references `aufgaben-*`
 * and the same dialog on main, which asks for none of it.
 */
function visitNextStepCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'visit-next-steps-2026-11-14',
    captures: [
      {
        id: 'admin-wartung-abschluss-dialog',
        role: 'admin',
        route: '/service/wartung',
        view: { kind: 'dialog', opener: 'service.due-completion' },
        ...both,
      },
      {
        id: 'admin-aufgaben',
        role: 'admin',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: aufgabenWithReturnStep,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(visitNextStepCaptures());
