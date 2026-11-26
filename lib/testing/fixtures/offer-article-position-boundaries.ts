// The real offer actions for a Position from an article over the in-memory
// database: a field worker is refused before any database access, another
// organization's article is not found and never reaches the save, an
// article with a unit outside the list answers without one, and Büro's save
// stores the purchase cost the server read for its own organization, never
// one the client sent.
// supabase/tests/offers.sql proves the stored article, the hidden cost and the refusals.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const offerId = '95000000-0000-4000-8000-000000000001';
const articleIds = {
  own: '96000000-0000-4000-8000-000000000001',
  legacyUnit: '96000000-0000-4000-8000-000000000003',
  unpriced: '96000000-0000-4000-8000-000000000004',
  foreign: '96000000-0000-4000-8000-000000000009',
};

const article = (id: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id,
  organization_id: organizationId,
  internal_sku: 'KR-15',
  name: 'Kupferrohr 15 mm',
  description: 'Hartkupfer',
  unit: 'meter',
  tax_rate_basis_points: 1900,
  is_active: true,
  sale_amount_cents: 1234,
  sale_price_quantity: 1,
  purchase_amount_cents: 8120,
  purchase_price_quantity: 10,
  ...fields,
});

const world = installActionWorld({
  inventory_items: [
    article(articleIds.own, ORGANIZATION_A),
    article(articleIds.legacyUnit, ORGANIZATION_A, { unit: 'Bogen', internal_sku: null }),
    article(articleIds.unpriced, ORGANIZATION_A, { purchase_amount_cents: null }),
    article(articleIds.foreign, ORGANIZATION_B),
  ],
});
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const SAVED = { contentVersion: 2, updatedAt: '2026-11-26T08:00:00.123456+00:00' };

/** E1's price function from the world's articles, for the organization each call names; the save succeeds. */
world.rpc = ({ name, args }) => {
  if (name === 'read_inventory_item_prices_on_day') {
    const rows = tableRows(world, 'inventory_items')
      .filter(
        (row) =>
          row.organization_id === args.p_organization_id &&
          Array.isArray(args.p_item_ids) &&
          args.p_item_ids.includes(row.id),
      )
      .map((row) => ({
        item_id: row.id,
        unit: row.unit,
        tax_rate_basis_points: row.tax_rate_basis_points,
        purchase_amount_cents: row.purchase_amount_cents,
        purchase_price_quantity: row.purchase_amount_cents === null ? null : row.purchase_price_quantity,
        purchase_valid_from: row.purchase_amount_cents === null ? null : '2026-01-01',
        purchase_source: row.purchase_amount_cents === null ? null : 'manual',
        sale_amount_cents: row.sale_amount_cents,
        sale_price_quantity: row.sale_price_quantity,
        sale_valid_from: '2026-01-01',
        sale_source: 'manual',
      }));
    return { data: rows, error: null };
  }
  if (name === 'save_offer_content') return { data: SAVED, error: null };
  return { data: null, error: { message: `unexpected ${name}` } };
};

const { readOfferArticleLine } = await import('@/lib/invoices/line-source-actions');
const { saveOfferContent } = await import('@/lib/offers/actions');

const articlePosition = (id: string, fields: Record<string, unknown> = {}) => ({
  kind: 'free' as const,
  name: 'Kupferrohr 15 mm',
  description: '',
  quantity: '2.5',
  unit: 'meter',
  unitPriceCents: 1234,
  priceQuantity: 1 as const,
  taxRateBasisPoints: 1900 as const,
  source: { kind: 'article' as const, id },
  ...fields,
});
const contentWith = (positions: ReadonlyArray<ReturnType<typeof articlePosition>>) => ({
  offerId,
  expectedContentVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000101',
  sections: [{ title: 'Material', positions: [...positions] }],
});

// A field worker neither reads an article's price for an offer nor saves a Position from one.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['readOfferArticleLine', () => readOfferArticleLine({ articleId: articleIds.own })],
    [
      'saveOfferContent with an article',
      () => saveOfferContent(contentWith([articlePosition(articleIds.own)])),
    ],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

signInAs(world, 'buero');
// A bad id never reaches the database.
await assertRefused(
  world,
  [
    ['readOfferArticleLine bad id', () => readOfferArticleLine({ articleId: 'KR-15' })],
    ['saveOfferContent bad article id', () => saveOfferContent(contentWith([articlePosition('KR-15')]))],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Another organization's article is not found: E1's reader, asked for Büro's own organization,
// leaves it out, so neither the prefill nor the save goes on (the save function refuses it too).
const foreignReads: Array<[string, () => Promise<unknown>, string]> = [
  ['readOfferArticleLine', () => readOfferArticleLine({ articleId: articleIds.foreign }), 'source_not_found'],
  [
    'saveOfferContent',
    () => saveOfferContent(contentWith([articlePosition(articleIds.foreign)])),
    'article_not_found',
  ],
];
for (const [label, call, error] of foreignReads) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await call(), { success: false, error }, `${label} foreign article: the refusal changed`);
  assert.deepEqual(
    world.rpcCalls.map((rpc) => [rpc.name, rpc.args.p_organization_id]),
    [['read_inventory_item_prices_on_day', ORGANIZATION_A]],
    `${label} foreign article: called more than the price read of its own organization`,
  );
}

// Büro's own article becomes a Position with today's sale price; one with a unit outside the list
// answers without a unit, which the editor asks for. Both read their own organization only.
world.rpcCalls.length = 0;
assert.deepEqual(await readOfferArticleLine({ articleId: articleIds.own }), {
  success: true,
  line: {
    name: 'Kupferrohr 15 mm',
    description: 'Hartkupfer',
    unit: 'meter',
    unitPriceCents: 1234,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
    source: {
      kind: 'article',
      id: articleIds.own,
      number: 'KR-15',
      name: 'Kupferrohr 15 mm',
      archived: false,
    },
  },
});
const legacy = await readOfferArticleLine({ articleId: articleIds.legacyUnit });
assert.equal(legacy.success && legacy.line.unit, null, 'an article with a unit outside the list kept a unit');
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [
    ['read_inventory_item_prices_on_day', ORGANIZATION_A],
    ['read_inventory_item_prices_on_day', ORGANIZATION_A],
  ],
);

// The save stores the purchase cost the server read today, per price quantity, beside each
// Position that keeps its article's unit. A cost the client sends is dropped; a Position in
// another unit, an article without a cost and a Position typed by hand keep none.
world.rpcCalls.length = 0;
const forged = articlePosition(articleIds.own, { purchaseCost: { amountCents: 1, priceQuantity: 1 } });
assert.deepEqual(
  await saveOfferContent(
    contentWith([
      forged,
      articlePosition(articleIds.own, { unit: 'piece' }),
      articlePosition(articleIds.unpriced),
      articlePosition(articleIds.own, { source: null }),
    ]),
  ),
  { success: true, offerId, ...SAVED },
);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id ?? null]),
  [
    ['read_inventory_item_prices_on_day', ORGANIZATION_A, null],
    ['save_offer_content', ORGANIZATION_A, CALLER_ID],
  ],
);
const saved = world.rpcCalls[1]?.args.p_sections;
assert.ok(Array.isArray(saved));
const positions: unknown = saved[0]?.positions;
assert.ok(Array.isArray(positions));
assert.deepEqual(
  positions.map((position) => [position.source?.id ?? null, position.purchaseCost ?? null]),
  [
    [articleIds.own, { amountCents: 8120, priceQuantity: 10 }],
    [articleIds.own, null],
    [articleIds.unpriced, null],
    [null, null],
  ],
);
