import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

type Line = [
  name: string,
  quantity: string,
  unit: string,
  label: string,
  cents: number,
  per: number,
  rate: number,
  amount: number,
];

function free([
  name,
  quantity,
  unit,
  unitLabel,
  unitPriceCents,
  priceQuantity,
  taxRateBasisPoints,
  amountCents,
]: Line) {
  return {
    kind: 'free',
    name,
    description: '',
    quantity,
    unit,
    unitLabel,
    unitPriceCents,
    priceQuantity,
    taxRateBasisPoints,
    amountCents,
  };
}

// Amounts as lib/offers/amounts.ts computes them (its table of cases holds the installation's Heizung).
const SERVICE = {
  title: 'Wartung Gasheizung',
  sections: [
    {
      title: 'Wartung',
      netCents: 12_675,
      positions: [
        free(['Wartung Gastherme', '1.5', 'hour', 'Std', 7250, 1, 1900, 10_875]),
        free(['Kleinmaterial', '1', 'flat_rate', 'psch', 1800, 1, 1900, 1800]),
        { kind: 'text', name: 'Hinweis', description: 'Ersatzteile rechnen wir nach Aufwand ab.' },
      ],
    },
  ],
  totals: { netCents: 12_675, taxCents: 2408, grossCents: 15_083 },
};

const INSTALLATION = {
  title: 'Heizungstausch Einfamilienhaus',
  sections: [
    {
      title: 'Demontage',
      netCents: 38_000,
      positions: [
        free(['Altgerät demontieren und entsorgen', '1', 'flat_rate', 'psch', 38_000, 1, 1900, 38_000]),
      ],
    },
    {
      title: 'Heizung',
      netCents: 432_379,
      positions: [
        free(['Gas-Brennwerttherme', '1', 'piece', 'Stk', 425_000, 1, 1900, 425_000]),
        free(['Kupferrohr 15 mm', '2.125', 'meter', 'm', 1249, 1, 1900, 2654]),
        free(['Rohrschellen', '250', 'piece', 'Stk', 1890, 100, 1900, 4725]),
        {
          kind: 'text',
          name: 'Hinweis',
          description: 'Die Altanlage bleibt bis zur Inbetriebnahme in Betrieb.',
        },
      ],
    },
    {
      title: 'Warmwasser',
      netCents: 141_500,
      positions: [
        free(['Warmwasserspeicher 150 l', '1', 'piece', 'Stk', 98_000, 1, 1900, 98_000]),
        free(['Montage', '6', 'hour', 'Std', 7250, 1, 1900, 43_500]),
      ],
    },
    {
      title: 'Nachlass und Zubehör',
      netCents: -12_005,
      positions: [
        free(['Nachlass', '-1', 'flat_rate', 'psch', 15_000, 1, 1900, -15_000]),
        free(['Wartungsheft', '1', 'piece', 'Stk', 2995, 1, 700, 2995]),
      ],
    },
  ],
  totals: { netCents: 599_874, taxCents: 113_617, grossCents: 713_491 },
};

/** A made-up customer with a service offer of one Titel and an installation offer of four. Returns both ids, space-separated. */
async function seedOffers(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offer-positions', async () => {
    const admin = createAdminClient();
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({ id: clientId, organization_id: world.orgId, name: `Erika Musterfrau ${world.runId}` })
      .throwOnError();
    const ids: string[] = [];
    for (const offer of [SERVICE, INSTALLATION]) {
      const { data: offerId } = await admin
        .rpc(
          'create_offer',
          rpcArgs('create_offer', {
            p_actor_id: world.users.buero.id,
            p_organization_id: world.orgId,
            p_attempt_key: randomUUID(),
            p_title: `${offer.title} ${world.runId}`,
            p_client_id: clientId,
            p_site_id: null,
            p_contact_id: null,
            p_work_kind: null,
            p_work_id: null,
          }),
        )
        .throwOnError();
      if (!offerId) throw new Error('The offer fixture returned no offer.');
      await admin
        .rpc('save_offer_content', {
          p_actor_id: world.users.buero.id,
          p_organization_id: world.orgId,
          p_offer_id: offerId,
          p_expected_content_version: 1,
          p_attempt_key: randomUUID(),
          p_sections: offer.sections,
          p_totals: offer.totals,
        })
        .throwOnError();
      ids.push(offerId);
    }
    return ids.join(' ');
  });
}

function offerPage(kind: 'service' | 'installation') {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    const [service, installation] = (await seedOffers(world)).split(' ');
    const title = `${(kind === 'service' ? SERVICE : INSTALLATION).title} ${world.runId}`;
    return { route: `/angebote/${kind === 'service' ? service : installation}`, heading: title };
  };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#452 of 2026-11-26: a draft offer's Titel and
 * Positionen with their totals, a service offer of one Titel and an
 * installation offer of four, and the page while it loads, for Admin and
 * Büro. The page before the change is `offer-header-2026-11-23`'s
 * `<role>-angebot`. A failed read is a region the server renders, which no
 * browser interception can produce.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  const route = '/angebote/[offerId]';
  return [
    { id: `${role}-wartung`, role, route, view: page, destination: offerPage('service'), ...both },
    { id: `${role}-installation`, role, route, view: page, destination: offerPage('installation'), ...both },
    { id: stateCaptureId(`${role}-wartung`, 'loading'), role, route, view: page, state: 'loading', ...both },
  ];
}

acceptanceSet({
  id: 'offer-positions-2026-11-26',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
