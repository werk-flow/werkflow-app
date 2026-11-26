import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedArticleWithTerms } from '../../../golden/support/db/inventory';
import { seedLeistung } from '../../../golden/support/db/price-catalog';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const OFFER = 'Heizungstausch Lindenhof';
const LEISTUNG = 'Monteurstunde';

function leistungName(world: TestWorld): string {
  return `${LEISTUNG} ${world.runId}`;
}

/**
 * A made-up customer's draft offer with each Position kind and its cost, as
 * the save stores it. Titel 1 „Montage“: 2,5 h of a Leistung at 72,50 € with
 * its cost rate 41,80 €; 12,5 m of an article at 64,90 € per 10 m with its
 * purchase cost 412,00 € per 100 m; a typed Position without a cost; a text
 * line. Titel 2 „Wartung“: a Position at 7 % and a returned part that
 * credits its price and cost. Returns the offer id.
 */
async function seedCalculatedOffer(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offer-calculation', async () => {
    const admin = createAdminClient();
    const leistungId = await seedLeistung({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      leistungNumber: `L-${world.runId}`,
      name: leistungName(world),
      prices: [{ validFrom: '2026-01-01', salePriceCents: 7250, costRateCents: 4180 }],
    });
    const articleId = await seedArticleWithTerms({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      name: `Kupferrohr 15 mm ${world.runId}`,
    });
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({ id: clientId, organization_id: world.orgId, name: `Erika Musterfrau ${world.runId}` })
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
      unit: 'piece',
      unitLabel: 'Stk',
      priceQuantity: 1,
      taxRateBasisPoints: 1900,
      source: null,
      purchaseCost: null,
      ...fields,
    });
    // Titel 1: 181,25 € + 81,13 € (81,125 €) + 25,00 € = 287,38 €. Titel 2: 29,95 € − 50,00 € = −20,05 €.
    // VAT 19 % on 237,38 € is 45,10 €, 7 % on 29,95 € is 2,10 €.
    await admin
      .rpc('save_offer_content', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_offer_id: offerId,
        p_expected_content_version: 1,
        p_attempt_key: randomUUID(),
        p_sections: [
          {
            title: 'Montage',
            netCents: 28_738,
            positions: [
              priced({
                name: leistungName(world),
                quantity: '2.5',
                unit: 'hour',
                unitLabel: 'Std',
                unitPriceCents: 7250,
                amountCents: 18_125,
                source: { kind: 'leistung', id: leistungId },
                purchaseCost: { amountCents: 4180, priceQuantity: 1 },
              }),
              priced({
                name: `Kupferrohr 15 mm ${world.runId}`,
                quantity: '12.5',
                unit: 'meter',
                unitLabel: 'm',
                unitPriceCents: 6490,
                priceQuantity: 10,
                amountCents: 8113,
                source: { kind: 'article', id: articleId },
                purchaseCost: { amountCents: 41_200, priceQuantity: 100 },
              }),
              priced({
                name: 'Kleinmaterial pauschal',
                quantity: '1',
                unitPriceCents: 2500,
                amountCents: 2500,
              }),
              {
                kind: 'text',
                name: 'Hinweis',
                description: 'Die Altanlage bleibt bis zur Inbetriebnahme in Betrieb.',
              },
            ],
          },
          {
            title: 'Wartung',
            netCents: -2005,
            positions: [
              priced({
                name: 'Wartungsheft',
                quantity: '1',
                unitPriceCents: 2995,
                taxRateBasisPoints: 700,
                amountCents: 2995,
                purchaseCost: { amountCents: 1200, priceQuantity: 1 },
              }),
              priced({
                name: 'Rücknahme Umwälzpumpe',
                quantity: '-1',
                unitPriceCents: 5000,
                amountCents: -5000,
                purchaseCost: { amountCents: 3000, priceQuantity: 1 },
              }),
            ],
          },
        ],
        p_totals: { netCents: 26_733, taxCents: 4720, grossCents: 31_453 },
      })
      .throwOnError();
    return offerId;
  });
}

async function calculatedOffer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/angebote/${await seedCalculatedOffer(world)}`, heading: `${OFFER} ${world.runId}` };
}

async function showCalculation(scope: Locator): Promise<void> {
  await scope.getByRole('region', { name: 'Kalkulation' }).evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
}

/**
 * Picks the Leistung in Titel 1's „Leistung hinzufügen“ once and puts 25 % on
 * its cost rate; a later width shows the added Position again.
 */
async function addLeistungWithMarkup(scope: Locator, world: TestWorld): Promise<void> {
  const notes = scope.getByText(`Aus Leistung L-${world.runId} · ${leistungName(world)}`, { exact: true });
  if ((await notes.count()) < 2) {
    await scope.getByRole('combobox', { name: 'Leistung zu Titel 1 hinzufügen' }).click();
    await scope.page().getByRole('textbox', { name: 'Nummer oder Name…' }).fill(LEISTUNG);
    await scope
      .page()
      .getByRole('option', { name: new RegExp(leistungName(world)) })
      .click();
    await expect(notes).toHaveCount(2);
  }
  // The new Position is the fifth of Titel 1: 41,80 € plus 25 % is 52,25 €.
  await scope.locator('#offer-section-0-position-4-markup').fill('25');
  await expect(scope.locator('#offer-section-0-position-4-price')).toHaveValue('52,25');
  await scope.locator('#offer-section-0-position-4-markup').evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });
}

/**
 * On the Position without a cost: a markup says it needs one while typing,
 * and a cost that does not read stops „Speichern“ at its field.
 */
async function unreadableCost(scope: Locator): Promise<void> {
  // Each width runs this again on the same page: it starts without a cost.
  await scope.locator('#offer-section-0-position-2-cost').fill('');
  await scope.locator('#offer-section-0-position-2-markup').fill('25');
  await expect(scope.getByText('Trag zuerst die Kosten ein.')).toBeVisible();
  await scope.locator('#offer-section-0-position-2-cost').fill('12,345');
  await scope.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    scope.getByText('Gib die Kosten netto an, zum Beispiel 48,20, oder lass das Feld leer.'),
  ).toBeVisible();
  await expect(scope.locator('#offer-section-0-position-2-cost')).toBeFocused();
}

/**
 * werk-flow/werkflow-planning#382 of 2026-11-26: each priced Position shows
 * its cost and margin with „Kosten netto“ and „Aufschlag %“, „Kalkulation“
 * sums them per Titel and for the offer, and „Leistung hinzufügen“ adds a
 * Leistung with its cost rate, for Admin and Büro. The editor before the
 * change is `offer-article-positions-2026-11-26`.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = {
    role,
    route: '/angebote/[offerId]',
    view: { kind: 'page' },
    destination: calculatedOffer,
  } as const;
  return [
    { id: `${role}-positionsarten`, ...page, ...both, reveal: 'Summe Titel 2: -20,05 €' },
    { id: `${role}-kalkulation`, ...page, ...both, act: showCalculation },
    { id: `${role}-leistung-aufschlag`, ...page, ...both, act: addLeistungWithMarkup },
    { id: `${role}-kalkulation-fehler`, ...page, ...both, act: unreadableCost },
  ];
}

acceptanceSet({
  id: 'offer-calculation-2026-11-26',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
