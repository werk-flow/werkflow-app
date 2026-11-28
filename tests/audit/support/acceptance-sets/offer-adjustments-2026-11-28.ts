import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import { confirmed } from '../../../golden/support/steps/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const OFFER = 'Heizungstausch Ulmenhof';

/**
 * A made-up customer's draft offer with a Nachlass and a Zuschlag, as the save
 * stores it. Titel 1 „Heizung“: 1.1 a wall unit at 4.250,00 € (19 %), 1.2 a
 * service booklet at 29,95 € (7 %), 1.3 a Neutralisationsbox at 185,00 € if
 * needed, 1.4 3 % off the Titel's Normalpositionen: 127,50 € at 19 % and
 * 0,90 € at 7 %. Titel 2 „Inbetriebnahme“: 6,5 h at 72,00 € and a fixed
 * Zuschlag of 25,00 € at 19 %. Returns the offer id.
 */
async function seedAdjustedOffer(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offer-adjustments', async () => {
    const admin = createAdminClient();
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({ id: clientId, organization_id: world.orgId, name: `Hausverwaltung Ulmenhof ${world.runId}` })
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
    // 19 % on 4.615,50 € is 876,945 €, 7 % on 29,05 € is 2,0335 €.
    await admin
      .rpc('save_offer_content', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_offer_id: offerId,
        p_expected_content_version: 1,
        p_attempt_key: randomUUID(),
        p_sections: [
          {
            title: 'Heizung',
            netCents: 415_155,
            positions: [
              priced({
                name: 'Wandgerät Brennwert 24 kW',
                unitPriceCents: 425_000,
                amountCents: 425_000,
                purchaseCost: { amountCents: 310_000, priceQuantity: 1 },
              }),
              priced({
                name: 'Wartungsheft',
                unitPriceCents: 2995,
                amountCents: 2995,
                taxRateBasisPoints: 700,
                purchaseCost: { amountCents: 1200, priceQuantity: 1 },
              }),
              priced({
                name: 'Neutralisationsbox',
                unitPriceCents: 18_500,
                amountCents: 18_500,
                positionType: { kind: 'bedarf' },
              }),
              {
                kind: 'adjustment',
                name: 'Nachlass',
                description: 'Für Stammkunden',
                adjustment: { direction: 'rabatt', scope: 'titel', percentHundredths: 300 },
                amountCents: -12_840,
                taxSplit: [
                  { taxRateBasisPoints: 1900, amountCents: -12_750 },
                  { taxRateBasisPoints: 700, amountCents: -90 },
                ],
              },
            ],
          },
          {
            title: 'Inbetriebnahme',
            netCents: 49_300,
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
              {
                kind: 'adjustment',
                name: 'Kleinmengenzuschlag',
                description: '',
                adjustment: {
                  direction: 'zuschlag',
                  scope: 'betrag',
                  amountCents: 2500,
                  taxRateBasisPoints: 1900,
                },
                amountCents: 2500,
                taxSplit: [{ taxRateBasisPoints: 1900, amountCents: 2500 }],
              },
            ],
          },
        ],
        p_totals: {
          netCents: 464_455,
          taxCents: 87_898,
          grossCents: 552_353,
          positionTypes: true,
          adjustments: true,
        },
      })
      .throwOnError();
    return offerId;
  });
}

async function adjustedOffer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/angebote/${await seedAdjustedOffer(world)}`, heading: `${OFFER} ${world.runId}` };
}

async function showCalculation(scope: Locator): Promise<void> {
  await scope.getByRole('region', { name: 'Kalkulation' }).evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
}

/**
 * Types a percentage that does not read into 1.4: „Speichern“ then stops at
 * its „Prozent“. Each width runs this again on the same page.
 */
async function unreadablePercentage(scope: Locator): Promise<void> {
  const row = confirmed(scope.getByRole('listitem', { name: 'Position 1.4' }));
  await row.getByRole('textbox', { name: 'Prozent' }).fill('drei');
  await scope.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    scope.getByText('Gib den Prozentsatz von 0,01 bis 100 an, zum Beispiel 3 oder 2,5.'),
  ).toBeVisible();
  await expect(row.getByRole('textbox', { name: 'Prozent' })).toBeFocused();
}

/**
 * werk-flow/werkflow-planning#611 of 2026-11-28: a Nachlass of a Titel split
 * by VAT rate and a fixed Zuschlag in the editor, „Kalkulation“ and the
 * preview, and a save refused while a percentage does not read, for Admin and
 * Büro. The editor before the change is `offer-position-types-2026-11-27`.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { role, route: '/angebote/[offerId]', destination: adjustedOffer, ...both } as const;
  return [
    {
      id: `${role}-nachlass-editor`,
      ...page,
      view: { kind: 'page' },
      reveal: 'Von den normalen Positionen, ohne Bedarfs- und Alternativpositionen.',
    },
    { id: `${role}-nachlass-kalkulation`, ...page, view: { kind: 'page' }, act: showCalculation },
    {
      id: `${role}-nachlass-vorschau`,
      ...page,
      view: { kind: 'dialog', opener: 'commercial.offer-preview' },
    },
    { id: `${role}-nachlass-fehler`, ...page, view: { kind: 'page' }, act: unreadablePercentage },
  ];
}

acceptanceSet({
  id: 'offer-adjustments-2026-11-28',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
