// The real article price reader over the in-memory database: a field worker
// is refused before any database access, Büro reads the prices of its own
// organization's articles, archived ones included, through
// `read_inventory_item_prices_on_day` with its own organization and the asked day,
// and an article id of another organization is left out of the answer.
// supabase/tests/inventory_article_prices.sql proves which price applies on a
// day before, between and after two prices.
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownItemId = '91000000-0000-4000-8000-000000000001';
const archivedItemId = '91000000-0000-4000-8000-000000000002';
const legacyUnitItemId = '91000000-0000-4000-8000-000000000003';
const foreignItemId = '91000000-0000-4000-8000-000000000004';

const article = (id: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id,
  organization_id: organizationId,
  unit: 'meter',
  tax_rate_basis_points: 1900,
  is_active: true,
  ...fields,
});

// One applying price per kind and article: the SQL test owns the choice between several.
const price = (
  itemId: string,
  kind: string,
  amount: number,
  quantity: number,
  validFrom: string,
  source: string,
) => ({
  item_id: itemId,
  kind,
  amount_cents: amount,
  price_quantity: quantity,
  valid_from: validFrom,
  source,
});

const world = installActionWorld({
  inventory_items: [
    article(ownItemId, ORGANIZATION_A),
    article(archivedItemId, ORGANIZATION_A, { is_active: false }),
    article(legacyUnitItemId, ORGANIZATION_A, { unit: 'Bogen' }),
    article(foreignItemId, ORGANIZATION_B),
  ],
  inventory_item_prices: [
    price(ownItemId, 'purchase', 61000, 100, '2026-01-01', 'csv_import'),
    price(ownItemId, 'sale', 1234, 1, '2026-11-12', 'manual'),
    price(archivedItemId, 'sale', 990, 10, '2025-06-30', 'carried_over'),
    price(foreignItemId, 'sale', 9999, 1, '2026-01-01', 'manual'),
  ],
});

/** `read_inventory_item_prices_on_day` from the world's tables, for the organization the call names. */
world.rpc = ({ name, args }) => {
  if (name !== 'read_inventory_item_prices_on_day')
    return { data: null, error: { message: `unexpected ${name}` } };
  const ids = Array.isArray(args.p_item_ids) ? args.p_item_ids : [];
  const of = (itemId: unknown, kind: string) =>
    tableRows(world, 'inventory_item_prices').find((row) => row.item_id === itemId && row.kind === kind);
  const rows = tableRows(world, 'inventory_items')
    .filter((row) => row.organization_id === args.p_organization_id && ids.includes(row.id))
    .map((row) => {
      const purchase = of(row.id, 'purchase');
      const sale = of(row.id, 'sale');
      return {
        item_id: row.id,
        unit: row.unit,
        tax_rate_basis_points: row.tax_rate_basis_points,
        purchase_price_id: null,
        purchase_amount_cents: purchase?.amount_cents ?? null,
        purchase_price_quantity: purchase?.price_quantity ?? null,
        purchase_valid_from: purchase?.valid_from ?? null,
        purchase_source: purchase?.source ?? null,
        sale_price_id: null,
        sale_amount_cents: sale?.amount_cents ?? null,
        sale_price_quantity: sale?.price_quantity ?? null,
        sale_valid_from: sale?.valid_from ?? null,
        sale_source: sale?.source ?? null,
      };
    });
  return { data: rows, error: null };
};

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
const call = world.rpcCalls.at(-1);
assert.equal(
  call?.args.p_organization_id,
  ORGANIZATION_A,
  'the reader asks for the caller’s organization only',
);
assert.equal(call?.args.p_on_date, '2026-11-12', 'the reader asks for the day it was given');
assert.deepEqual(result, {
  success: true,
  prices: [
    {
      articleId: ownItemId,
      unit: 'meter',
      purchaseCost: { amountCents: 61000, priceQuantity: 100, validFrom: '2026-01-01', origin: 'csv_import' },
      salePrice: { amountCents: 1234, priceQuantity: 1, validFrom: '2026-11-12', origin: 'manual' },
      taxRateBasisPoints: 1900,
      // Both prices apply from the later first day.
      priceDate: '2026-11-12',
      source: 'article',
    },
    {
      articleId: archivedItemId,
      unit: 'meter',
      purchaseCost: null,
      salePrice: { amountCents: 990, priceQuantity: 10, validFrom: '2025-06-30', origin: 'carried_over' },
      taxRateBasisPoints: 1900,
      priceDate: '2025-06-30',
      source: 'article',
    },
    {
      articleId: legacyUnitItemId,
      unit: null,
      purchaseCost: null,
      salePrice: null,
      taxRateBasisPoints: 1900,
      // No price applies: the asked day, as the contract keeps the field a day.
      priceDate: '2026-11-12',
      source: 'article',
    },
  ],
});

// Only the foreign id: an empty answer, never another organization's price.
assert.deepEqual(await readArticlePrices([foreignItemId], '2026-11-12'), { success: true, prices: [] });

// A malformed answer is a failed read, never a price.
world.rpc = () => ({ data: [{ item_id: ownItemId, purchase_price_quantity: 25 }], error: null });
assert.deepEqual(await readArticlePrices([ownItemId], '2026-11-12'), {
  success: false,
  error: 'load_failed',
});

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
