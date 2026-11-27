import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const OFFER = 'Heizungserneuerung Birkenweg';

/**
 * A made-up customer's draft offer with each Positionsart, as the save stores
 * it. Titel 1 „Wärmeerzeuger“: 1.1 a wall unit at 4.890,00 €, a text line,
 * 1.2 a Neutralisationsbox at 185,00 € if needed, 1.3 a smaller wall unit at
 * 4.520,00 € instead of 1.1. Titel 2 „Inbetriebnahme“: 6,5 h at 72,00 €.
 * Only 1.1 and 2.1 count: 5.358,00 € net. Returns the offer id.
 */
async function seedTypedOffer(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offer-position-types', async () => {
    const admin = createAdminClient();
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({ id: clientId, organization_id: world.orgId, name: `Hausverwaltung Birkenweg ${world.runId}` })
      .throwOnError();
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
    const priced = (fields: Record<string, unknown>) => ({
      kind: 'free',
      description: '',
      quantity: '1',
      unit: 'piece',
      unitLabel: 'Stk',
      priceQuantity: 1,
      taxRateBasisPoints: 1900,
      source: null,
      ...fields,
    });
    // VAT 19 % on 5.358,00 € is 1.018,02 €.
    await admin
      .rpc('save_offer_content', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_offer_id: offerId,
        p_expected_content_version: 1,
        p_attempt_key: randomUUID(),
        p_sections: [
          {
            title: 'Wärmeerzeuger',
            netCents: 489_000,
            positions: [
              priced({
                name: 'Wandgerät Brennwert 24 kW',
                unitPriceCents: 489_000,
                amountCents: 489_000,
                purchaseCost: { amountCents: 352_000, priceQuantity: 1 },
              }),
              { kind: 'text', name: 'Hinweis', description: 'Die Abgasführung bleibt bestehen.' },
              priced({
                name: 'Neutralisationsbox',
                description: 'Nur wenn der Abwasseranschluss sie verlangt.',
                unitPriceCents: 18_500,
                amountCents: 18_500,
                purchaseCost: { amountCents: 9000, priceQuantity: 1 },
                positionType: { kind: 'bedarf' },
              }),
              priced({
                name: 'Wandgerät Brennwert 18 kW',
                unitPriceCents: 452_000,
                amountCents: 452_000,
                purchaseCost: { amountCents: 331_000, priceQuantity: 1 },
                positionType: { kind: 'alternative', alternativeTo: 1 },
              }),
            ],
          },
          {
            title: 'Inbetriebnahme',
            netCents: 46_800,
            positions: [
              priced({
                name: 'Montage und Inbetriebnahme',
                quantity: '6.5',
                unit: 'hour',
                unitLabel: 'Std',
                unitPriceCents: 7200,
                amountCents: 46_800,
                purchaseCost: { amountCents: 4180, priceQuantity: 1 },
              }),
            ],
          },
        ],
        p_totals: { netCents: 535_800, taxCents: 101_802, grossCents: 637_602 },
      })
      .throwOnError();
    return offerId;
  });
}

async function typedOffer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/angebote/${await seedTypedOffer(world)}`, heading: `${OFFER} ${world.runId}` };
}

async function showCalculation(scope: Locator): Promise<void> {
  await scope.getByRole('region', { name: 'Kalkulation' }).evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
}

/**
 * Makes 1.1 a Bedarfsposition: „Speichern“ then stops at 1.3's „Alternative
 * zu“, which names no Normalposition any more. Each width runs this again on
 * the same page.
 */
async function alternativeWithoutPosition(scope: Locator): Promise<void> {
  await scope.locator('#offer-section-0-position-0-alternative-type').click();
  await scope.page().getByRole('option', { name: 'Bedarfsposition', exact: true }).click();
  await scope.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    scope.getByText('Wähle die Position, statt der diese Alternative angeboten wird.'),
  ).toBeVisible();
  await expect(scope.locator('#offer-section-0-position-3-alternative')).toBeFocused();
}

/**
 * werk-flow/werkflow-planning#580 of 2026-11-27: a priced Position's
 * „Positionsart“ (Bedarfsposition, Alternativposition with its Position and
 * difference), outside every sum of the editor, „Kalkulation“ and the
 * preview, and a save refused while an Alternativposition names no
 * Normalposition, for Admin and Büro. The editor before the change is
 * `offer-calculation-2026-11-26`.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { role, route: '/angebote/[offerId]', destination: typedOffer, ...both } as const;
  return [
    {
      id: `${role}-positionsarten-editor`,
      ...page,
      view: { kind: 'page' },
      reveal: 'Alternativposition zu 1.1, Minderpreis 370,00 €. Nicht in der Summe.',
    },
    { id: `${role}-positionsarten-kalkulation`, ...page, view: { kind: 'page' }, act: showCalculation },
    {
      id: `${role}-positionsarten-vorschau`,
      ...page,
      view: { kind: 'dialog', opener: 'commercial.offer-preview' },
    },
    { id: `${role}-positionsarten-fehler`, ...page, view: { kind: 'page' }, act: alternativeWithoutPosition },
  ];
}

acceptanceSet({
  id: 'offer-position-types-2026-11-27',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
