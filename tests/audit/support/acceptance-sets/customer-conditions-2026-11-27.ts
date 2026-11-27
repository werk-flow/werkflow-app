import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedLeistung } from '../../../golden/support/db/price-catalog';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const CUSTOMER = 'Hausverwaltung Lindenhof GmbH';
const OFFER = 'Wartung Lindenhof';

async function seedCustomer(world: TestWorld, name: string): Promise<string> {
  const clientId = randomUUID();
  await createAdminClient()
    .from('clients')
    .insert({ id: clientId, organization_id: world.orgId, name: `${name} ${world.runId}` })
    .throwOnError();
  return clientId;
}

/**
 * A made-up Hausverwaltung with two versions of its conditions: version 1
 * since 01.01.2026 with 10 % on material, 5 % on Arbeit and 68,00 € per
 * Monteurstunde, and version 2 from 01.01.2037 with 12,5 % on material.
 * Returns the customer.
 */
async function seedConditionedCustomer(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-customer-conditions', async () => {
    const admin = createAdminClient();
    const leistungId = await seedLeistung({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      leistungNumber: `KON-${world.runId}`,
      name: `Monteurstunde ${world.runId}`,
      prices: [{ validFrom: '2026-01-01', salePriceCents: 7250, costRateCents: 4180 }],
    });
    const clientId = await seedCustomer(world, CUSTOMER);
    const record = async (
      version: number,
      validFrom: string,
      material: number,
      prices: Array<{ leistungId: string; salePriceCents: number }>,
    ) => {
      await admin
        .rpc(
          'record_client_price_condition',
          rpcArgs('record_client_price_condition', {
            p_actor_id: world.users.buero.id,
            p_organization_id: world.orgId,
            p_client_id: clientId,
            p_expected_version: version - 1,
            p_attempt_key: randomUUID(),
            p_valid_from: validFrom,
            p_material_discount_tenths: material,
            p_arbeit_discount_tenths: 50,
            p_anfahrt_discount_tenths: 0,
            p_leistung_prices: prices,
          }),
        )
        .throwOnError();
    };
    const ownPrices = [{ leistungId, salePriceCents: 6800 }];
    await record(1, '2026-01-01', 100, ownPrices);
    await record(2, '2037-01-01', 125, ownPrices);
    return clientId;
  });
}

/**
 * A draft offer of that customer with one Position of each price source: the
 * Monteurstunde at the customer's own price, the same at the list price and a
 * typed one. Returns the offer id.
 */
async function seedOfferWithSources(world: TestWorld): Promise<string> {
  const clientId = await seedConditionedCustomer(world);
  return surfaceFixture(world, 'commercial.acceptance-offer-price-sources', async () => {
    const admin = createAdminClient();
    const { data: condition } = await admin
      .from('client_price_conditions')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('client_id', clientId)
      .eq('version', 1)
      .single()
      .throwOnError();
    const { data: leistung } = await admin
      .from('leistungen')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('leistung_number', `KON-${world.runId}`)
      .single()
      .throwOnError();
    const conditionId = condition.id;
    const leistungId = leistung.id;
    const { data: offerId } = await admin
      .rpc(
        'create_offer',
        rpcArgs('create_offer', {
          p_actor_id: world.users.buero.id,
          p_organization_id: world.orgId,
          p_attempt_key: randomUUID(),
          p_title: `${OFFER} ${world.runId}`,
          p_client_id: clientId,
          p_site_id: null,
          p_contact_id: null,
          p_work_kind: null,
          p_work_id: null,
        }),
      )
      .throwOnError();
    if (!offerId) throw new Error('The offer fixture returned no offer.');
    const hour = (unitPriceCents: number, priceSource: { kind: string; conditionId: string | null }) => ({
      kind: 'free',
      name: `Monteurstunde ${world.runId}`,
      description: '',
      quantity: '2',
      unit: 'hour',
      unitLabel: 'Std',
      unitPriceCents,
      priceQuantity: 1,
      taxRateBasisPoints: 1900,
      amountCents: unitPriceCents * 2,
      source: { kind: 'leistung', id: leistungId },
      purchaseCost: { amountCents: 4180, priceQuantity: 1 },
      priceSource,
    });
    // 136,00 € + 145,00 € + 25,00 € = 306,00 €; VAT 19 % is 58,14 €.
    await admin
      .rpc('save_offer_content', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_offer_id: offerId,
        p_expected_content_version: 1,
        p_attempt_key: randomUUID(),
        p_sections: [
          {
            title: 'Wartung',
            netCents: 30_600,
            positions: [
              hour(6800, { kind: 'kundenkondition', conditionId }),
              hour(7250, { kind: 'listenpreis', conditionId: null }),
              {
                kind: 'free',
                name: 'Kleinmaterial pauschal',
                description: '',
                quantity: '1',
                unit: 'flat_rate',
                unitLabel: 'psch',
                unitPriceCents: 2500,
                priceQuantity: 1,
                taxRateBasisPoints: 1900,
                amountCents: 2500,
                source: null,
                purchaseCost: null,
                priceSource: { kind: 'manuell' },
              },
            ],
          },
        ],
        p_totals: { netCents: 30_600, taxCents: 5814, grossCents: 36_414 },
      })
      .throwOnError();
    return offerId;
  });
}

async function customerWithoutConditions(world: TestWorld): Promise<SurfaceDestination> {
  const clientId = await surfaceFixture(world, 'commercial.acceptance-customer-without-conditions', () =>
    seedCustomer(world, 'Erika Musterfrau'),
  );
  return { route: `/kunden/${clientId}` };
}

async function customerWithConditions(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden/${await seedConditionedCustomer(world)}` };
}

async function offerWithSources(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/angebote/${await seedOfferWithSources(world)}`, heading: `${OFFER} ${world.runId}` };
}

async function showConditions(scope: Locator): Promise<void> {
  await scope.getByRole('heading', { name: 'Konditionen', exact: true }).evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
}

async function openChangeDialog(scope: Locator): Promise<void> {
  const dialog = scope.page().getByRole('dialog', { name: 'Konditionen ändern' });
  // A later width finds the dialog still open; the page behind it is hidden then.
  if (!(await dialog.isVisible())) {
    await showConditions(scope);
    await scope.getByRole('button', { name: 'Konditionen ändern', exact: true }).click();
  }
  await expect(dialog.getByRole('textbox', { name: 'Material' })).toHaveValue('12,5');
}

/**
 * werk-flow/werkflow-planning#384 of 2026-11-27: the customer page's
 * „Konditionen“ without and with versions, the dialog that records a new
 * one, and an offer whose Positionen name their price source, for Admin and
 * Büro. The customer page before the change is `site-roles-2026-11-11`, the
 * editor before it `offer-calculation-2026-11-26`.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { role, widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const customer = { route: '/kunden/[clientId]', view: { kind: 'page' } } as const;
  return [
    {
      id: `${role}-konditionen-leer`,
      ...customer,
      ...both,
      destination: customerWithoutConditions,
      act: showConditions,
    },
    {
      id: `${role}-konditionen`,
      ...customer,
      ...both,
      destination: customerWithConditions,
      act: showConditions,
    },
    {
      id: `${role}-konditionen-aendern`,
      ...customer,
      ...both,
      destination: customerWithConditions,
      act: openChangeDialog,
    },
    {
      id: `${role}-preisherkunft`,
      route: '/angebote/[offerId]',
      view: { kind: 'page' },
      ...both,
      destination: offerWithSources,
      reveal: 'Preis: Kundenkondition 1 ab 01.01.2026',
    },
  ];
}

acceptanceSet({
  id: 'customer-conditions-2026-11-27',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
