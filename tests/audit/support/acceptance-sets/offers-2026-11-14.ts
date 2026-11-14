import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const CUSTOMER = 'WEG Lindenstraße 5';
const OFFER = 'Austausch Gas-Brennwerttherme Haus A';

/**
 * Two customers of „Haustechnik Sonnenberg“: a WEG whose Objekt has the
 * Hausverwaltung as Rechnungsempfänger, and three offers written as the
 * office's create writes them. Returns the WEG's id.
 */
async function seedOffers(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offers', async () => {
    const admin = createAdminClient();
    const orgId = world.orgId;
    const suffix = ` ${world.runId}`;
    const [weg, verwaltung] = [randomUUID(), randomUUID()];
    await admin
      .from('clients')
      .insert([
        {
          id: weg,
          organization_id: orgId,
          name: `${CUSTOMER}${suffix}`,
          address: 'Lindenstraße 5, 10115 Berlin',
        },
        { id: verwaltung, organization_id: orgId, name: `Hausverwaltung Lindenhof GmbH${suffix}` },
      ])
      .throwOnError();
    const siteId = randomUUID();
    await admin
      .from('client_sites')
      .insert({
        id: siteId,
        organization_id: orgId,
        client_id: weg,
        name: 'Haus A',
        street: 'Lindenstraße 5',
        postal_code: '10115',
        city: 'Berlin',
      })
      .throwOnError();
    await admin
      .from('client_site_roles')
      .insert({
        organization_id: orgId,
        site_id: siteId,
        client_id: weg,
        holder_client_id: verwaltung,
        role: 'rechnungsempfaenger',
      })
      .throwOnError();
    const offers: [string, string | null][] = [
      [`${OFFER}${suffix}`, siteId],
      [`Wartung Heizungsanlage${suffix}`, null],
      [`Badsanierung Wohnung 3${suffix}`, siteId],
    ];
    for (const [title, site] of offers) {
      await admin
        .rpc(
          'create_offer',
          rpcArgs('create_offer', {
            p_actor_id: world.users.buero.id,
            p_organization_id: orgId,
            p_attempt_key: randomUUID(),
            p_title: title,
            p_client_id: weg,
            p_site_id: site,
            p_contact_id: null,
            p_work_kind: null,
            p_work_id: null,
          }),
        )
        .throwOnError();
    }
    return weg;
  });
}

async function offerList(world: TestWorld): Promise<SurfaceDestination> {
  await seedOffers(world);
  return { route: `/angebote?q=${encodeURIComponent(world.runId)}` };
}

async function offerPage(world: TestWorld): Promise<SurfaceDestination> {
  const clientId = await seedOffers(world);
  const title = `${OFFER} ${world.runId}`;
  const { data } = await createAdminClient()
    .from('offers')
    .select('id')
    .eq('organization_id', world.orgId)
    .eq('client_id', clientId)
    .eq('title', title)
    .single()
    .throwOnError();
  return { route: `/angebote/${data.id}`, heading: title };
}

async function customerPage(world: TestWorld): Promise<SurfaceDestination> {
  const clientId = await seedOffers(world);
  return { route: `/kunden/${clientId}`, heading: `${CUSTOMER} ${world.runId}` };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#380 of 2026-11-14: „Angebote“ empty, filled
 * and loading, „Angebot anlegen“, one offer's page and the customer's offers,
 * for Admin and Büro. A failed read is a region the server renders, which no
 * browser interception can produce.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return [
    { id: `${role}-liste`, role, route: '/angebote', view: page, destination: offerList, ...both },
    {
      id: stateCaptureId(`${role}-liste`, 'loading'),
      role,
      route: '/angebote',
      view: page,
      state: 'loading',
      ...both,
    },
    {
      id: `${role}-anlegen`,
      role,
      route: '/angebote',
      view: { kind: 'dialog', opener: 'commercial.offer' },
      ...both,
    },
    {
      id: `${role}-angebot`,
      role,
      route: '/angebote/[offerId]',
      view: page,
      destination: offerPage,
      ...both,
    },
    {
      id: `${role}-kunde`,
      role,
      route: '/kunden/[clientId]',
      view: page,
      destination: customerPage,
      ...both,
    },
  ];
}

function offerCaptures(): OpenSet {
  return {
    id: 'offers-2026-11-14',
    captures: [
      // Empty runs first: the filled captures seed the world's offers.
      {
        id: 'admin-leer',
        role: 'admin',
        route: '/angebote',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      ...roleCaptures('admin'),
      ...roleCaptures('buero'),
    ],
    standalone: [],
  };
}

acceptanceSet(offerCaptures());
