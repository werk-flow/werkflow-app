// The real offer actions for a Position from an article or a Leistung over
// the in-memory database: a field worker is refused before any database
// access, another organization's entry or offer is not found, an article
// with a unit outside the list answers without one, the offer's read carries
// the entry's cost and its customer's conditions while the invoice's read of
// the same entry carries neither, and Büro's save hands each Position's own
// cost and price source to the database for its own organization and actor.
// The customer's conditions are recorded only by Admin and Büro, for their
// own organization and as themselves.
// supabase/tests/offers.sql and client_price_conditions.sql prove the stored
// source, the hidden cost, the conditions and the refusals.
import assert from 'node:assert/strict';

process.env.SUPABASE_SECRET_KEY = 'fixture-secret-key';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { OfferPositionCost } from '@/lib/offers/types';
import type { PriceSourceClaim } from '@/lib/price-catalog/customer-conditions';
import { assertRefused } from './operations-boundary-refusals';

const offerId = '95000000-0000-4000-8000-000000000001';
const plainOfferId = '95000000-0000-4000-8000-000000000002';
const foreignOfferId = '95000000-0000-4000-8000-000000000009';
const clientIds = {
  conditioned: '94000000-0000-4000-8000-000000000001',
  plain: '94000000-0000-4000-8000-000000000002',
  foreign: '94000000-0000-4000-8000-000000000009',
};
const conditionId = '98000000-0000-4000-8000-000000000002';
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
  kind: 'arbeit',
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
  offers: [
    { id: offerId, organization_id: ORGANIZATION_A, client_id: clientIds.conditioned },
    { id: plainOfferId, organization_id: ORGANIZATION_A, client_id: clientIds.plain },
    { id: foreignOfferId, organization_id: ORGANIZATION_B, client_id: clientIds.foreign },
  ],
});
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const SAVED = { contentVersion: 2, updatedAt: '2026-11-26T08:00:00.123456+00:00' };

/** Haustechnik Sonnenberg's own conditions since 2026-01-01: 10 % on material, 68,00 € per Monteurstunde. */
const CONDITION = {
  id: conditionId,
  version: 2,
  validFrom: '2026-01-01',
  materialDiscountTenths: 100,
  arbeitDiscountTenths: 50,
  anfahrtDiscountTenths: 0,
};

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
  if (name === 'get_offer_price_condition') {
    const offer = tableRows(world, 'offers').find(
      (row) => row.organization_id === args.p_organization_id && row.id === args.p_offer_id,
    );
    if (!offer) return { data: null, error: null };
    const ownPriceCents = args.p_leistung_id === leistungIds.own ? 6800 : null;
    const condition = offer.client_id === clientIds.conditioned ? { ...CONDITION, ownPriceCents } : null;
    return { data: { condition }, error: null };
  }
  if (name === 'save_offer_content') return { data: SAVED, error: null };
  return { data: null, error: { message: `unexpected ${name}` } };
};

const { readInvoiceLineSource, readOfferArticleLine, readOfferLeistungLine } = await import(
  '@/lib/invoices/line-source-actions'
);
const { saveOfferContent } = await import('@/lib/offers/actions');
const { recordCustomerCondition } = await import('@/lib/price-catalog/actions');
const { signPriceSource } = await import('@/lib/price-catalog/price-source-proof');

/** The proof the server signs for a source of a Position of the organization's offer. */
const proofOf = (
  forOffer: string,
  entry: { kind: 'article' | 'leistung'; id: string },
  kind: 'listenpreis' | 'kundenkondition',
  unitPriceCents: number,
  /** The unit the read answered; a Position saved in another one loses the source. */
  unit = 'meter',
) =>
  signPriceSource({
    organizationId: ORGANIZATION_A,
    offerId: forOffer,
    entry,
    kind,
    conditionId: kind === 'kundenkondition' ? conditionId : null,
    unit,
    unitPriceCents,
    priceQuantity: 1,
  });

const position = (
  source: { kind: 'article' | 'leistung'; id: string } | null,
  cost: OfferPositionCost | null = null,
  priceSource: PriceSourceClaim = { kind: 'manuell' },
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
  priceSource,
});
const contentWith = (
  positions: ReadonlyArray<
    Omit<ReturnType<typeof position>, 'priceQuantity'> & { priceQuantity: PriceQuantity }
  >,
) => ({
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
    [
      'readOfferArticleLine',
      () => readOfferArticleLine({ offerId: plainOfferId, articleId: articleIds.own }),
    ],
    [
      'readOfferLeistungLine',
      () => readOfferLeistungLine({ offerId: plainOfferId, leistungId: leistungIds.own }),
    ],
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
    ['readOfferArticleLine bad id', () => readOfferArticleLine({ offerId, articleId: 'KR-15' })],
    ['readOfferLeistungLine bad id', () => readOfferLeistungLine({ offerId, leistungId: 'L-7' })],
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
    () => readOfferArticleLine({ offerId: plainOfferId, articleId: articleIds.foreign }),
    'read_inventory_item_prices_on_day',
  ],
  [
    'readOfferLeistungLine',
    () => readOfferLeistungLine({ offerId: plainOfferId, leistungId: leistungIds.foreign }),
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
    // The two reads run side by side, in either order.
    world.rpcCalls.map((rpc) => [rpc.name, rpc.args.p_organization_id]).sort(),
    [
      ['get_offer_price_condition', ORGANIZATION_A],
      [priceRead, ORGANIZATION_A],
    ].sort(),
    `${label}: called more than the reads of its own organization`,
  );
}

// Another organization's offer is not found: the conditions read names Büro's own organization,
// so it answers no customer's conditions of it.
for (const call of [
  () => readOfferArticleLine({ offerId: foreignOfferId, articleId: articleIds.own }),
  () => readOfferLeistungLine({ offerId: foreignOfferId, leistungId: leistungIds.own }),
]) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await call(), { success: false, error: 'offer_not_found' });
  assert.ok(
    world.rpcCalls.every((rpc) => rpc.args.p_organization_id === ORGANIZATION_A),
    'a read named another organization',
  );
}

// Büro's own entries become Positions with today's sale price and their cost: an article's
// purchase price per its price quantity, a Leistung's cost rate. One with a unit outside the
// list answers without a unit, which the editor asks for. A customer without conditions gets
// the list price.
assert.deepEqual(await readOfferArticleLine({ offerId: plainOfferId, articleId: articleIds.own }), {
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
    priceSource: {
      kind: 'listenpreis',
      proof: proofOf(plainOfferId, { kind: 'article', id: articleIds.own }, 'listenpreis', 1234),
    },
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
assert.deepEqual(await readOfferLeistungLine({ offerId: plainOfferId, leistungId: leistungIds.own }), {
  success: true,
  line: {
    ...leistungLine,
    cost: { amountCents: 4180, priceQuantity: 1 },
    priceSource: {
      kind: 'listenpreis',
      proof: proofOf(plainOfferId, { kind: 'leistung', id: leistungIds.own }, 'listenpreis', 7250, 'hour'),
    },
  },
});

// The customer's conditions of today price the same entries: the Leistung's own price, the
// article's list price less 10 % on material (1234 × 0,9 = 1110,6 → 1111), both naming the version
// with the server's proof for this offer.
const fromCondition = (
  entry: { kind: 'article' | 'leistung'; id: string },
  unitPriceCents: number,
  unit: string,
) => ({
  kind: 'kundenkondition',
  condition: { id: conditionId, version: 2, validFrom: '2026-01-01' },
  proof: proofOf(offerId, entry, 'kundenkondition', unitPriceCents, unit),
});
const ownLeistung = await readOfferLeistungLine({ offerId, leistungId: leistungIds.own });
assert.deepEqual(ownLeistung.success && [ownLeistung.line.unitPriceCents, ownLeistung.line.priceSource], [
  6800,
  fromCondition({ kind: 'leistung', id: leistungIds.own }, 6800, 'hour'),
]);
const ownArticle = await readOfferArticleLine({ offerId, articleId: articleIds.own });
assert.deepEqual(
  ownArticle.success && [
    ownArticle.line.unitPriceCents,
    ownArticle.line.priceQuantity,
    ownArticle.line.priceSource,
  ],
  [1111, 1, fromCondition({ kind: 'article', id: articleIds.own }, 1111, 'meter')],
);
const legacy = await readOfferArticleLine({ offerId: plainOfferId, articleId: articleIds.legacyUnit });
assert.equal(legacy.success && legacy.line.unit, null, 'an article with a unit outside the list kept a unit');

// An invoice line of the same Leistung reads as before offers kept a cost: none reaches it.
assert.deepEqual(await readInvoiceLineSource({ kind: 'leistung', id: leistungIds.own }), {
  success: true,
  line: leistungLine,
});

// The save hands each Position's own cost to the database as its cost store names it, and its
// price source, with the caller's organization and actor; it reads no price again. A source
// stays only with the server's proof for this offer, entry and price: a changed price, another
// offer's proof, a forged proof and a claim without a catalog entry are stored as „manuell“.
const pipe = { kind: 'article', id: articleIds.own } as const;
const hour = { kind: 'leistung', id: leistungIds.own } as const;
const claimOf = (entry: typeof pipe | typeof hour, unitPriceCents: number): PriceSourceClaim => ({
  kind: 'kundenkondition',
  conditionId,
  proof: proofOf(offerId, entry, 'kundenkondition', unitPriceCents),
});
world.rpcCalls.length = 0;
assert.deepEqual(
  await saveOfferContent(
    contentWith([
      { ...position(pipe, COST, claimOf(pipe, 1111)), unitPriceCents: 1111 },
      position(hour, { amountCents: 4180, priceQuantity: 1 }, claimOf(hour, 6800)),
      { ...position(hour, null, claimOf(hour, 6800)), unitPriceCents: 6800 },
      position(pipe, null, {
        kind: 'listenpreis',
        proof: proofOf(plainOfferId, pipe, 'listenpreis', 1234),
      }),
      position(null, { amountCents: 0, priceQuantity: 1 }, { kind: 'listenpreis', proof: 'A'.repeat(43) }),
      // The answered price per 100 instead of per one, and a forged proof on a real entry.
      { ...position(hour, null, claimOf(hour, 6800)), unitPriceCents: 6800, priceQuantity: 100 },
      position(pipe, null, { kind: 'listenpreis', proof: 'A'.repeat(43) }),
      // The answered price per hour on a Position the office switched to meters.
      {
        ...position(hour, null, {
          kind: 'kundenkondition',
          conditionId,
          proof: proofOf(offerId, hour, 'kundenkondition', 6800, 'hour'),
        }),
        unitPriceCents: 6800,
      },
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
  positions.map((entry) => [entry.source, entry.purchaseCost, 'cost' in entry, entry.priceSource]),
  [
    [pipe, COST, false, { kind: 'kundenkondition', conditionId }],
    // The Position's price is 12,34 €, not the condition's 68,00 €: the office changed it.
    [hour, { amountCents: 4180, priceQuantity: 1 }, false, { kind: 'manuell', conditionId: null }],
    [hour, null, false, { kind: 'kundenkondition', conditionId }],
    // Another offer's proof.
    [pipe, null, false, { kind: 'manuell', conditionId: null }],
    // A forged proof, and no catalog entry.
    [null, { amountCents: 0, priceQuantity: 1 }, false, { kind: 'manuell', conditionId: null }],
    [hour, null, false, { kind: 'manuell', conditionId: null }],
    [pipe, null, false, { kind: 'manuell', conditionId: null }],
    [hour, null, false, { kind: 'manuell', conditionId: null }],
  ],
);

// Only Admin and Büro record a customer's conditions, for their own organization and as
// themselves; a field worker is refused before any database access, a bad id before the call.
const conditionInput = {
  clientId: clientIds.conditioned,
  expectedVersion: 2,
  attemptKey: '98000000-0000-4000-8000-000000000101',
  validFrom: '2027-01-01',
  discountTenths: { material: 125, arbeit: 0, anfahrt: 50 },
  leistungPrices: [{ leistungId: leistungIds.own, salePriceCents: 6900 }],
};
signInAs(world, 'employee');
await assertRefused(
  world,
  [['recordCustomerCondition', () => recordCustomerCondition(conditionInput)]],
  { success: false, error: 'not_authorized' },
  'none',
);
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    [
      'recordCustomerCondition bad client',
      () => recordCustomerCondition({ ...conditionInput, clientId: 'K-1' }),
    ],
    [
      'recordCustomerCondition discount above 100 %',
      () =>
        recordCustomerCondition({
          ...conditionInput,
          discountTenths: { material: 1001, arbeit: 0, anfahrt: 0 },
        }),
    ],
    [
      'recordCustomerCondition one Leistung twice',
      () =>
        recordCustomerCondition({
          ...conditionInput,
          leistungPrices: [...conditionInput.leistungPrices, ...conditionInput.leistungPrices],
        }),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
// Another organization's customer: the one call names Büro's own organization, whose function
// refuses it (client_price_conditions.sql).
world.rpc = ({ name, args }) =>
  name === 'record_client_price_condition' && args.p_client_id === clientIds.foreign
    ? { data: null, error: { message: 'client_not_found', code: 'P0001' } }
    : {
        data: {
          conditionId,
          version: 3,
          clientId: args.p_client_id,
          updatedAt: '2026-11-27T08:00:00.123456+00:00',
        },
        error: null,
      };
world.rpcCalls.length = 0;
assert.deepEqual(await recordCustomerCondition({ ...conditionInput, clientId: clientIds.foreign }), {
  success: false,
  error: 'client_not_found',
});
assert.deepEqual(await recordCustomerCondition(conditionInput), {
  success: true,
  version: 3,
  clientId: clientIds.conditioned,
  updatedAt: '2026-11-27T08:00:00.123456+00:00',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_client_id,
  ]),
  [
    ['record_client_price_condition', ORGANIZATION_A, CALLER_ID, clientIds.foreign],
    ['record_client_price_condition', ORGANIZATION_A, CALLER_ID, clientIds.conditioned],
  ],
);
assert.deepEqual(world.rpcCalls[1]?.args.p_leistung_prices, conditionInput.leistungPrices);
