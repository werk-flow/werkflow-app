// The real offer actions for a Position from an article or a Leistung over
// the in-memory database: a field worker is refused before any database
// access, another organization's entry is not found, an article with a unit
// outside the list answers without one, the offer's read carries the
// entry's cost while the invoice's read of the same entry carries none, and
// Büro's save hands each Position's own cost to the database for its own
// organization and actor.
// supabase/tests/offers.sql proves the stored source, the hidden cost and the refusals.
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
import type { OfferPositionCost } from '@/lib/offers/types';
import { assertRefused } from './operations-boundary-refusals';

const offerId = '95000000-0000-4000-8000-000000000001';
const articleIds = {
  own: '96000000-0000-4000-8000-000000000001',
  legacyUnit: '96000000-0000-4000-8000-000000000003',
  foreign: '96000000-0000-4000-8000-000000000009',
};
const leistungIds = {
  own: '97000000-0000-4000-8000-000000000001',
  foreign: '97000000-0000-4000-8000-000000000009',
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

const leistung = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  leistung_number: 'L-7',
  name: 'Monteurstunde',
  description: 'Je angefangene Stunde',
  unit: 'hour',
  tax_rate_basis_points: 1900,
  archived_at: null,
  sale_price_cents: 7250,
  cost_rate_cents: 4180,
});

const world = installActionWorld({
  inventory_items: [
    article(articleIds.own, ORGANIZATION_A),
    article(articleIds.legacyUnit, ORGANIZATION_A, { unit: 'Bogen', internal_sku: null }),
    article(articleIds.foreign, ORGANIZATION_B),
  ],
  leistungen: [leistung(leistungIds.own, ORGANIZATION_A), leistung(leistungIds.foreign, ORGANIZATION_B)],
});
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const SAVED = { contentVersion: 2, updatedAt: '2026-11-26T08:00:00.123456+00:00' };

const ownRows = (table: string, organizationId: unknown, ids: unknown) =>
  tableRows(world, table).filter(
    (row) => row.organization_id === organizationId && Array.isArray(ids) && ids.includes(row.id),
  );

/** E1's and K3's price functions from the world's rows, for the organization each call names; the save succeeds. */
world.rpc = ({ name, args }) => {
  if (name === 'read_inventory_item_prices_on_day') {
    const rows = ownRows('inventory_items', args.p_organization_id, args.p_item_ids).map((row) => ({
      item_id: row.id,
      unit: row.unit,
      tax_rate_basis_points: row.tax_rate_basis_points,
      purchase_amount_cents: row.purchase_amount_cents,
      purchase_price_quantity: row.purchase_price_quantity,
      purchase_valid_from: '2026-01-01',
      purchase_source: 'manual',
      sale_amount_cents: row.sale_amount_cents,
      sale_price_quantity: row.sale_price_quantity,
      sale_valid_from: '2026-01-01',
      sale_source: 'manual',
    }));
    return { data: rows, error: null };
  }
  if (name === 'leistung_prices_on_day') {
    const rows = ownRows('leistungen', args.p_organization_id, args.p_leistung_ids).map((row) => ({
      leistung_id: row.id,
      unit: row.unit,
      tax_rate_basis_points: row.tax_rate_basis_points,
      price_version_id: '97000000-0000-4000-8000-000000000101',
      valid_from: '2026-01-01',
      sale_price_cents: row.sale_price_cents,
      cost_rate_cents: row.cost_rate_cents,
    }));
    return { data: rows, error: null };
  }
  if (name === 'save_offer_content') return { data: SAVED, error: null };
  return { data: null, error: { message: `unexpected ${name}` } };
};

const { readInvoiceLineSource, readOfferArticleLine, readOfferLeistungLine } = await import(
  '@/lib/invoices/line-source-actions'
);
const { saveOfferContent } = await import('@/lib/offers/actions');

const position = (
  source: { kind: 'article' | 'leistung'; id: string } | null,
  cost: OfferPositionCost | null = null,
) => ({
  kind: 'free' as const,
  name: 'Kupferrohr 15 mm',
  description: '',
  quantity: '2.5',
  unit: 'meter',
  unitPriceCents: 1234,
  priceQuantity: 1 as const,
  taxRateBasisPoints: 1900 as const,
  source,
  cost,
});
const contentWith = (positions: ReadonlyArray<ReturnType<typeof position>>) => ({
  offerId,
  expectedContentVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000101',
  sections: [{ title: 'Material', positions: [...positions] }],
});
const COST: OfferPositionCost = { amountCents: 8120, priceQuantity: 10 };

// A field worker reads no entry's price or cost for an offer and saves no Position with a cost.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['readOfferArticleLine', () => readOfferArticleLine({ articleId: articleIds.own })],
    ['readOfferLeistungLine', () => readOfferLeistungLine({ leistungId: leistungIds.own })],
    [
      'saveOfferContent with a cost',
      () => saveOfferContent(contentWith([position({ kind: 'leistung', id: leistungIds.own }, COST)])),
    ],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

signInAs(world, 'buero');
// A bad id never reaches the database (lib/offers/action-schemas.test.ts refuses a bad cost).
await assertRefused(
  world,
  [
    ['readOfferArticleLine bad id', () => readOfferArticleLine({ articleId: 'KR-15' })],
    ['readOfferLeistungLine bad id', () => readOfferLeistungLine({ leistungId: 'L-7' })],
    [
      'saveOfferContent bad Leistung id',
      () => saveOfferContent(contentWith([position({ kind: 'leistung', id: 'L-7' })])),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Another organization's article or Leistung is not found: the price reader, asked for Büro's own
// organization, leaves it out, so no price or cost answers.
const foreignReads: Array<[string, () => Promise<unknown>, string]> = [
  [
    'readOfferArticleLine',
    () => readOfferArticleLine({ articleId: articleIds.foreign }),
    'read_inventory_item_prices_on_day',
  ],
  [
    'readOfferLeistungLine',
    () => readOfferLeistungLine({ leistungId: leistungIds.foreign }),
    'leistung_prices_on_day',
  ],
];
for (const [label, call, priceRead] of foreignReads) {
  world.rpcCalls.length = 0;
  assert.deepEqual(
    await call(),
    { success: false, error: 'source_not_found' },
    `${label}: the refusal changed`,
  );
  assert.deepEqual(
    world.rpcCalls.map((rpc) => [rpc.name, rpc.args.p_organization_id]),
    [[priceRead, ORGANIZATION_A]],
    `${label}: called more than the price read of its own organization`,
  );
}

// Büro's own entries become Positions with today's sale price and their cost: an article's
// purchase price per its price quantity, a Leistung's cost rate. One with a unit outside the
// list answers without a unit, which the editor asks for.
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
    cost: COST,
  },
});
const leistungLine = {
  name: 'Monteurstunde',
  description: 'Je angefangene Stunde',
  unit: 'hour',
  unitPriceCents: 7250,
  priceQuantity: 1,
  taxRateBasisPoints: 1900,
  source: { kind: 'leistung', id: leistungIds.own, number: 'L-7', name: 'Monteurstunde', archived: false },
} as const;
assert.deepEqual(await readOfferLeistungLine({ leistungId: leistungIds.own }), {
  success: true,
  line: { ...leistungLine, cost: { amountCents: 4180, priceQuantity: 1 } },
});
const legacy = await readOfferArticleLine({ articleId: articleIds.legacyUnit });
assert.equal(legacy.success && legacy.line.unit, null, 'an article with a unit outside the list kept a unit');

// An invoice line of the same Leistung reads as before offers kept a cost: none reaches it.
assert.deepEqual(await readInvoiceLineSource({ kind: 'leistung', id: leistungIds.own }), {
  success: true,
  line: leistungLine,
});

// The save hands each Position's own cost to the database as its cost store names it, with the
// caller's organization and actor; it reads no price again.
world.rpcCalls.length = 0;
assert.deepEqual(
  await saveOfferContent(
    contentWith([
      position({ kind: 'article', id: articleIds.own }, COST),
      position({ kind: 'leistung', id: leistungIds.own }, { amountCents: 4180, priceQuantity: 1 }),
      position(null, { amountCents: 0, priceQuantity: 1 }),
      position(null),
    ]),
  ),
  { success: true, offerId, ...SAVED },
);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id]),
  [['save_offer_content', ORGANIZATION_A, CALLER_ID]],
);
const saved = world.rpcCalls[0]?.args.p_sections;
assert.ok(Array.isArray(saved));
const positions: unknown = saved[0]?.positions;
assert.ok(Array.isArray(positions));
assert.deepEqual(
  positions.map((entry) => [entry.source, entry.purchaseCost, 'cost' in entry]),
  [
    [{ kind: 'article', id: articleIds.own }, COST, false],
    [{ kind: 'leistung', id: leistungIds.own }, { amountCents: 4180, priceQuantity: 1 }, false],
    [null, { amountCents: 0, priceQuantity: 1 }, false],
    [null, null, false],
  ],
);
