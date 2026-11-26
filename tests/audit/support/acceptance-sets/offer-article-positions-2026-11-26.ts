import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedArticleWithTerms } from '../../../golden/support/db/inventory';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const ARTICLE = 'Kupferrohr 15 mm';
const OFFER = 'Heizkreis Keller';

function articleName(world: TestWorld): string {
  return `${ARTICLE} ${world.runId}`;
}

/**
 * A made-up customer's draft offer with one Titel „Material“ holding 12,5 m
 * of an article at its sale price of 64,90 € per 10 m (seedArticleWithTerms),
 * stored with its purchase cost as the save stores it. Returns the offer id.
 */
async function seedArticleOffer(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-offer-article-positions', async () => {
    const admin = createAdminClient();
    const articleId = await seedArticleWithTerms({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      name: articleName(world),
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
    // 12,5 m at 64,90 € per 10 m is 81,125 €, rounded to 81,13 €; 19 % VAT on it is 15,41 €.
    await admin
      .rpc('save_offer_content', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_offer_id: offerId,
        p_expected_content_version: 1,
        p_attempt_key: randomUUID(),
        p_sections: [
          {
            title: 'Material',
            netCents: 8113,
            positions: [
              {
                kind: 'free',
                name: articleName(world),
                description: '',
                quantity: '12.5',
                unit: 'meter',
                unitLabel: 'm',
                unitPriceCents: 6490,
                priceQuantity: 10,
                taxRateBasisPoints: 1900,
                amountCents: 8113,
                source: { kind: 'article', id: articleId },
                purchaseCost: { amountCents: 41_200, priceQuantity: 100 },
              },
            ],
          },
        ],
        p_totals: { netCents: 8113, taxCents: 1541, grossCents: 9654 },
      })
      .throwOnError();
    return offerId;
  });
}

async function articleOffer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/angebote/${await seedArticleOffer(world)}`, heading: `${OFFER} ${world.runId}` };
}

/** Picks the article in Titel 1's „Artikel hinzufügen“ once; a later width shows the added Position again. */
async function addArticle(scope: Locator, world: TestWorld): Promise<void> {
  const notes = scope.getByText(`Aus Artikel ${articleName(world)}`, { exact: true });
  if ((await notes.count()) < 2) {
    await scope.getByRole('combobox', { name: 'Artikel zu Titel 1 hinzufügen' }).click();
    await scope.page().getByRole('textbox', { name: 'Nummer oder Name…' }).fill(ARTICLE);
    await scope
      .page()
      .getByRole('option', { name: new RegExp(articleName(world)) })
      .click();
    await expect(notes).toHaveCount(2);
  }
  await scope
    .getByText('1.2', { exact: true })
    .first()
    .evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
}

/**
 * werk-flow/werkflow-planning#557 of 2026-11-26: a Position taken from an
 * article names its article under its number, and „Artikel hinzufügen“ adds
 * the article with today's price, for Admin and Büro. The editor before the
 * change is `offer-positions-2026-11-26`'s `<role>-wartung`. The unit
 * question needs an article whose stored unit is outside the list, which the
 * database no longer accepts as a new article; the component contract in
 * tests/ui-contracts/offers.spec.ts shows it.
 */
function roleCaptures(role: 'admin' | 'buero'): OpenSet['captures'] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = {
    role,
    route: '/angebote/[offerId]',
    view: { kind: 'page' },
    destination: articleOffer,
  } as const;
  return [
    { id: `${role}-artikel-position`, ...page, ...both, reveal: 'Summe Titel 1: 81,13 €' },
    { id: `${role}-artikel-hinzugefuegt`, ...page, ...both, act: addArticle },
  ];
}

acceptanceSet({
  id: 'offer-article-positions-2026-11-26',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
