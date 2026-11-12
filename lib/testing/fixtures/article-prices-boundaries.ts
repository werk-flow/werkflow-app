// The real article price reader over the in-memory database: a field worker
// is refused before any database access, Büro reads the prices of its own
// organization's articles, archived ones included, and an article id of
// another organization is left out of the answer.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownItemId = '91000000-0000-4000-8000-000000000001';
const archivedItemId = '91000000-0000-4000-8000-000000000002';
const legacyUnitItemId = '91000000-0000-4000-8000-000000000003';
const foreignItemId = '91000000-0000-4000-8000-000000000004';

const article = (id: string, organizationId: string, fields: Record<string, unknown>) => ({
  id,
  organization_id: organizationId,
  unit: 'meter',
  purchase_price_cents: 812,
  sale_price_cents: 1234,
  tax_rate_basis_points: 1900,
  is_active: true,
  // 23:30 UTC is the next day in Berlin.
  updated_at: '2026-11-11T23:30:00.000Z',
  ...fields,
});

const world = installActionWorld({
  inventory_items: [
    article(ownItemId, ORGANIZATION_A, {}),
    article(archivedItemId, ORGANIZATION_A, { is_active: false, purchase_price_cents: null }),
    article(legacyUnitItemId, ORGANIZATION_A, { unit: 'Bogen', sale_price_cents: null }),
    article(foreignItemId, ORGANIZATION_B, {}),
  ],
});
const { readArticlePrices } = await import('@/lib/inventory/article-prices');

// A field worker never reads a price: refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(
  world,
  [['readArticlePrices', () => readArticlePrices([ownItemId], '2026-11-12')]],
  { success: false, error: 'not_authorized' },
  'none',
);

// Büro reads its own articles, archived ones too; another organization's article is not in the answer.
signInAs(world, 'buero');
const result = await readArticlePrices(
  [foreignItemId, ownItemId, archivedItemId, legacyUnitItemId],
  '2026-11-12',
);
assert.deepEqual(result, {
  success: true,
  prices: [
    {
      articleId: ownItemId,
      unit: 'meter',
      purchaseCost: { amountCents: 812, priceQuantity: 1 },
      salePrice: { amountCents: 1234, priceQuantity: 1 },
      taxRateBasisPoints: 1900,
      priceDate: '2026-11-12',
      source: 'article',
    },
    {
      articleId: archivedItemId,
      unit: 'meter',
      purchaseCost: null,
      salePrice: { amountCents: 1234, priceQuantity: 1 },
      taxRateBasisPoints: 1900,
      priceDate: '2026-11-12',
      source: 'article',
    },
    {
      articleId: legacyUnitItemId,
      unit: null,
      purchaseCost: { amountCents: 812, priceQuantity: 1 },
      salePrice: null,
      taxRateBasisPoints: 1900,
      priceDate: '2026-11-12',
      source: 'article',
    },
  ],
});

// Only the foreign id: an empty answer, never another organization's price.
assert.deepEqual(await readArticlePrices([foreignItemId], '2026-11-12'), { success: true, prices: [] });

// An id or a date the reader cannot read is refused before the database.
await assertRefused(
  world,
  [
    ['readArticlePrices bad id', () => readArticlePrices(['not-a-uuid'], '2026-11-12')],
    ['readArticlePrices bad date', () => readArticlePrices([ownItemId], '12.11.2026')],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
