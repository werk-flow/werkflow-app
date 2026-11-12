import { worldName } from '../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../golden/support/db/customers';
import { createAdminClient } from '../../golden/support/db/shared';
import { seedJob, seedJobAssignment } from '../../golden/support/db/work';
import type { TestWorld } from '../../golden/support/world';
import { surfaceFixture } from './surface-fixtures';

/** What became of the field worker's access proposal on the seeded job. */
export type SiteAccessJobState = 'none' | 'open' | 'rejected';

const JOB_CODES: Record<SiteAccessJobState, string> = { none: 'ZUG', open: 'ZUGO', rejected: 'ZUGA' };

/** The number and title of the seeded job in that state. */
export function siteAccessJob(
  world: TestWorld,
  state: SiteAccessJobState,
): { jobNumber: string; title: string } {
  return {
    jobNumber: `A-${world.runId}-${JOB_CODES[state]}`,
    title: worldName('Heizungswartung Lindenhof', world.runId),
  };
}

/**
 * A job of the employee at an Einsatzort with one Zugangskontakt, once per
 * world and state: without a proposal, with the employee's open proposal, or
 * with a proposal the office rejected. Setup writes through the real database
 * functions, so the rows are what the app writes.
 */
export async function seedSiteAccessJob(world: TestWorld, state: SiteAccessJobState): Promise<void> {
  const { jobNumber, title } = siteAccessJob(world, state);
  await surfaceFixture(world, `acceptance.site-access-${state}`, async () => {
    const admin = createAdminClient();
    const siteName = 'Lindenhof 5';
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      clientType: 'gewerblich',
      sites: [
        {
          name: siteName,
          street: 'Lindenhof 5',
          postalCode: '10115',
          city: 'Berlin',
          accessNotes: 'Schlüssel beim Hausmeister',
        },
      ],
    });
    const siteId = customer.siteIds.get(siteName);
    if (!siteId) throw new Error('seedSiteAccessJob: the Einsatzort was not seeded');
    await admin
      .from('client_contacts')
      .insert({
        organization_id: world.orgId,
        client_id: customer.clientId,
        created_by: world.users.admin.id,
        name: 'Herr Albrecht',
        phone: '030 1234567',
        site_id: siteId,
        site_role: 'zugangskontakt',
      })
      .throwOnError();
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title,
      clientId: customer.clientId,
      siteId,
    });
    await seedJobAssignment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobId,
      userId: world.users.employee.id,
    });
    if (state === 'none') return jobNumber;
    const { data: proposal } = await admin
      .rpc('propose_site_access', {
        p_actor_id: world.users.employee.id,
        p_organization_id: world.orgId,
        p_job_id: jobId,
        p_site_id: siteId,
        p_contact_name: 'Erika Musterfrau',
        p_contact_phone: '0160 5550123',
        p_contact_note: 'Neue Hausmeisterin, ab 7 Uhr da',
        p_access_notes: 'Seiteneingang über den Hof, Klingel „Hausmeister“',
      })
      .throwOnError();
    if (state === 'rejected' && proposal) {
      await admin
        .rpc('reject_site_access_proposal', {
          p_actor_id: world.users.admin.id,
          p_organization_id: world.orgId,
          p_proposal_id: proposal.id,
          p_reason: 'Herr Albrecht ist weiter zuständig, Frau Musterfrau vertritt ihn nur im Urlaub.',
        })
        .throwOnError();
    }
    return jobNumber;
  });
}
