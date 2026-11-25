import { randomUUID } from 'node:crypto';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedStoredImageDocument } from '../../../golden/support/db/documents';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

type Converted = { requestId: string; summary: string; clientId: string; customer: string; photo: string };

/**
 * A request of „Erika Musterfrau“ at her house with one photo, converted by
 * the Büro into an offer draft the way the dialog's Angebot tab converts it.
 */
async function seedConvertedRequest(world: TestWorld): Promise<Converted> {
  const summary = worldName('Gastherme im Keller tauschen', world.runId);
  const customer = worldName('Erika Musterfrau', world.runId);
  const photo = worldName('Typenschild Therme', world.runId);
  const ids = await surfaceFixture(world, 'acceptance.request-converted-to-offer', async () => {
    const seeded = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      sites: [{ name: 'Wohnhaus', street: 'Ahornweg 12', postalCode: '10115', city: 'Berlin' }],
    });
    const siteId = seeded.siteIds.get('Wohnhaus');
    if (!siteId) throw new Error('seedConvertedRequest: the site was not seeded');
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      details: 'Die Therme ist 22 Jahre alt. Bitte ein Angebot für eine Brennwerttherme.',
      requestNumber: `ANF-${world.runId}-ANG`,
      clientId: seeded.clientId,
      siteId,
    });
    const documentId = await seedStoredImageDocument({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      displayName: `${photo}.png`,
    });
    const admin = createAdminClient();
    await admin
      .from('document_links')
      .insert({
        organization_id: world.orgId,
        document_id: documentId,
        request_id: requestId,
        created_by: world.users.admin.id,
      })
      .throwOnError();
    await admin
      .rpc(
        'convert_client_request_to_offer',
        rpcArgs('convert_client_request_to_offer', {
          p_organization_id: world.orgId,
          p_actor_id: world.users.buero.id,
          p_request_id: requestId,
          p_attempt_key: randomUUID(),
          p_client_id: seeded.clientId,
          p_title: summary,
          p_site_id: siteId,
          p_contact_id: null,
        }),
      )
      .throwOnError();
    return `${requestId}|${seeded.clientId}`;
  });
  const [requestId = '', clientId = ''] = ids.split('|');
  return { requestId, summary, clientId, customer, photo };
}

async function convertedRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedConvertedRequest(world);
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function libraryWithOfferPhoto(world: TestWorld): Promise<SurfaceDestination> {
  const { photo } = await seedConvertedRequest(world);
  // The opener compares the decoded address with the route, so the query stays unencoded.
  return { route: `/dokumente?q=${photo}` };
}

async function customerHistory(world: TestWorld): Promise<SurfaceDestination> {
  const { clientId, customer } = await seedConvertedRequest(world);
  return { route: `/kunden/${clientId}`, heading: customer };
}

/**
 * werk-flow/werkflow-planning#386 of 2026-11-23: the request converted into
 * an offer names it, the request's photo carries the offer's badge in the
 * library, and the customer history names the offer; Admin and Büro.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return [
    {
      id: `${role}-anfrage-angebot`,
      role,
      route: '/anfragen/[requestId]',
      view: page,
      destination: convertedRequest,
      ...both,
    },
    {
      id: `${role}-dokumente-angebot`,
      role,
      route: '/dokumente',
      view: page,
      destination: libraryWithOfferPhoto,
      // At 1280 px the table showed only the name column; the phone list shows the badge.
      widths: [1680, 375],
      schemes: ['light', 'dark'],
    },
    {
      id: `${role}-kunde-historie`,
      role,
      route: '/kunden/[clientId]',
      view: page,
      destination: customerHistory,
      reveal: 'Kundenhistorie',
      ...both,
    },
  ];
}

acceptanceSet({
  id: 'request-offer-2026-11-23',
  captures: [
    ...roleCaptures('admin'),
    ...roleCaptures('buero'),
    {
      id: 'admin-anfrage-umwandeln',
      role: 'admin',
      route: '/anfragen/[requestId]',
      view: { kind: 'dialog', opener: 'requests.convert' },
      widths: [1280, 375],
      schemes: ['light', 'dark'],
    },
  ],
  standalone: [],
});
