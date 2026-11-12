import { randomUUID } from 'node:crypto';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedProject } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * A Hausverwaltung with two sites and an open request at Lindenhof 1. Unless
 * `none`, the customer has an open job at that site, and an open job and a
 * project at Lindenhof 7, so the attach dialog lists the request's site
 * first. `attached` seeds its own customer, work and request, so attaching
 * that request leaves the open request of `work` open in the same world.
 */
async function seedAttachableRequest(
  world: TestWorld,
  variant: 'work' | 'none' | 'attached',
): Promise<{ requestId: string; summary: string; jobNumber: string; jobTitle: string }> {
  const suffix = variant.toUpperCase();
  const withWork = variant !== 'none';
  const summary = worldName(
    withWork ? 'Heizkörper im Bad wird nicht warm' : 'Wasserhahn tropft',
    world.runId,
  );
  const jobNumber = `A-${world.runId}-${suffix}`;
  const jobTitle = worldName('Heizungswartung Lindenhof 1', world.runId);
  const requestId = await surfaceFixture(world, `acceptance.attachable-request-${suffix}`, async () => {
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: worldName(withWork ? 'Hausverwaltung Lindenhof GmbH' : 'Erika Musterfrau', world.runId),
      sites: [
        { name: 'Lindenhof 1', street: 'Lindenstraße 1', postalCode: '10115', city: 'Berlin' },
        { name: 'Lindenhof 7', street: 'Lindenstraße 7', postalCode: '10115', city: 'Berlin' },
      ],
    });
    const siteId = customer.siteIds.get('Lindenhof 1');
    const otherSiteId = customer.siteIds.get('Lindenhof 7');
    if (!siteId || !otherSiteId) throw new Error('seedAttachableRequest: the sites were not seeded');
    if (withWork) {
      const owner = { orgId: world.orgId, actorId: world.users.admin.id, clientId: customer.clientId };
      await seedJob({ ...owner, jobNumber, title: jobTitle, siteId });
      await seedJob({
        ...owner,
        jobNumber: `A-${world.runId}-${suffix}-STRANG`,
        title: worldName('Strangsanierung Lindenhof 7', world.runId),
        siteId: otherSiteId,
      });
      await seedProject({
        ...owner,
        projectNumber: `P-${world.runId}-${suffix}-BAD`,
        name: worldName('Badsanierung Lindenhof 7', world.runId),
        siteId: otherSiteId,
      });
    }
    return seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      details: 'Seit gestern Abend, Wohnung 3 links. Die Mieterin ist ab 16 Uhr zu Hause.',
      requestNumber: `ANF-${world.runId}-${suffix}`,
      clientId: customer.clientId,
      siteId,
    });
  });
  return { requestId, summary, jobNumber, jobTitle };
}

async function attachableRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachableRequest(world, 'work');
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function requestWithoutOpenWork(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachableRequest(world, 'none');
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/** A request of its own, added by the Büro to the open job at its site. */
async function seedAttachedRequest(
  world: TestWorld,
): Promise<{ requestId: string; summary: string; jobNumber: string; jobTitle: string }> {
  const seeded = await seedAttachableRequest(world, 'attached');
  await surfaceFixture(world, 'acceptance.attached-request', async () => {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('job_number', seeded.jobNumber)
      .single()
      .throwOnError();
    await admin
      .rpc(
        'attach_client_request_to_work',
        rpcArgs('attach_client_request_to_work', {
          p_organization_id: world.orgId,
          p_actor_id: world.users.buero.id,
          p_request_id: seeded.requestId,
          p_job_id: job.id,
          p_project_id: null,
          p_service_case_id: null,
          p_attempt_key: randomUUID(),
        }),
      )
      .throwOnError();
    return job.id;
  });
  return seeded;
}

async function attachedRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachedRequest(world);
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function jobWithAttachedRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { jobNumber, jobTitle } = await seedAttachedRequest(world);
  return { route: `/auftraege/${encodeURIComponent(jobNumber)}`, heading: jobTitle };
}

/**
 * werk-flow/werkflow-planning#328 of 2026-11-09: the request detail with
 * „Zu Arbeit hinzufügen“, the attach dialog with and without open work, the
 * attached request, and its entry in the job's „Hinzugefügte Anfragen“.
 */
function requestAttachCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const request = { role: 'buero', route: '/anfragen/[requestId]' } as const;
  const attachDialog = { kind: 'dialog', opener: 'requests.attach-to-work' } as const;
  return {
    id: 'request-attach-2026-11-09',
    captures: [
      {
        id: 'buero-anfrage-offen',
        ...request,
        view: { kind: 'page' },
        destination: attachableRequest,
        ...both,
      },
      {
        id: 'buero-anfrage-hinzufuegen',
        ...request,
        view: attachDialog,
        destination: attachableRequest,
        ...both,
      },
      {
        id: 'buero-anfrage-hinzufuegen-leer',
        ...request,
        view: attachDialog,
        destination: requestWithoutOpenWork,
        ...both,
      },
      {
        id: 'buero-anfrage-hinzugefuegt',
        ...request,
        view: { kind: 'page' },
        destination: attachedRequest,
        ...both,
      },
      {
        id: 'buero-auftrag-hinzugefuegte-anfrage',
        role: 'buero',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: jobWithAttachedRequest,
        reveal: 'Hinzugefügte Anfragen',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(requestAttachCaptures());
