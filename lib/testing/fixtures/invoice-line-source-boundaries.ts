// The real catalog line action over the in-memory database: a field worker
// is refused before any database access, another organization's Leistung or
// article is not found, an archived, unpriced or unknown-unit entry is
// refused, and Büro gets today's price of its own entry through the readers
// of E2a and E1 with its own organization.
// supabase/tests/invoice_line_sources.sql proves the stored source and its refusals.
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const leistungIds = {
  own: '95000000-0000-4000-8000-000000000001',
  archived: '95000000-0000-4000-8000-000000000002',
  unpriced: '95000000-0000-4000-8000-000000000003',
  oddRate: '95000000-0000-4000-8000-000000000004',
  foreign: '95000000-0000-4000-8000-000000000009',
};
const articleIds = {
  own: '96000000-0000-4000-8000-000000000001',
  inactive: '96000000-0000-4000-8000-000000000002',
  legacyUnit: '96000000-0000-4000-8000-000000000003',
  foreign: '96000000-0000-4000-8000-000000000009',
};

const leistung = (id: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id,
  organization_id: organizationId,
  leistung_number: 'L-7',
  name: 'Monteurstunde',
  description: 'Arbeitszeit Geselle',
  unit: 'hour',
  tax_rate_basis_points: 1900,
  archived_at: null,
  sale_price_cents: 7250,
  ...fields,
});
const article = (id: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id,
  organization_id: organizationId,
  internal_sku: 'KR-15',
  name: 'Kupferrohr 15 mm',
  description: null,
  unit: 'meter',
  tax_rate_basis_points: 1900,
  is_active: true,
  sale_amount_cents: 1234,
  sale_price_quantity: 10,
  ...fields,
});

const world = installActionWorld({
  leistungen: [
    leistung(leistungIds.own, ORGANIZATION_A),
    leistung(leistungIds.archived, ORGANIZATION_A, { archived_at: '2026-11-01T08:00:00Z' }),
    leistung(leistungIds.unpriced, ORGANIZATION_A, { sale_price_cents: null }),
    leistung(leistungIds.oddRate, ORGANIZATION_A, { tax_rate_basis_points: 1600 }),
    leistung(leistungIds.foreign, ORGANIZATION_B),
  ],
  inventory_items: [
    article(articleIds.own, ORGANIZATION_A),
    article(articleIds.inactive, ORGANIZATION_A, { is_active: false }),
    article(articleIds.legacyUnit, ORGANIZATION_A, { unit: 'Bogen' }),
    article(articleIds.foreign, ORGANIZATION_B),
  ],
});

/** The two price readers' functions from the world's tables, for the organization each call names. */
world.rpc = ({ name, args }) => {
  const ownRows = (table: string, ids: unknown) =>
    tableRows(world, table).filter(
      (row) => row.organization_id === args.p_organization_id && Array.isArray(ids) && ids.includes(row.id),
    );
  if (name === 'leistung_prices_on_day') {
    const rows = ownRows('leistungen', args.p_leistung_ids).map((row) => ({
      leistung_id: row.id,
      unit: row.unit,
      tax_rate_basis_points: row.tax_rate_basis_points,
      price_version_id: row.sale_price_cents === null ? null : '93000000-0000-4000-8000-000000000001',
      valid_from: row.sale_price_cents === null ? null : '2026-01-01',
      sale_price_cents: row.sale_price_cents,
      cost_rate_cents: null,
    }));
    return { data: rows, error: null };
  }
  if (name === 'read_inventory_item_prices_on_day') {
    const rows = ownRows('inventory_items', args.p_item_ids).map((row) => ({
      item_id: row.id,
      unit: row.unit,
      tax_rate_basis_points: row.tax_rate_basis_points,
      purchase_amount_cents: null,
      purchase_price_quantity: null,
      purchase_valid_from: null,
      purchase_source: null,
      sale_amount_cents: row.sale_amount_cents,
      sale_price_quantity: row.sale_price_quantity,
      sale_valid_from: '2026-01-01',
      sale_source: 'manual',
    }));
    return { data: rows, error: null };
  }
  return { data: null, error: { message: `unexpected ${name}` } };
};

const { readInvoiceLineSource } = await import('@/lib/invoices/line-source-actions');
const leistungLine = (id: string) => readInvoiceLineSource({ kind: 'leistung', id });
const articleLine = (id: string) => readInvoiceLineSource({ kind: 'article', id });

// A field worker never reads a catalog price for an invoice.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['readInvoiceLineSource Leistung', () => leistungLine(leistungIds.own)],
    ['readInvoiceLineSource article', () => articleLine(articleIds.own)],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

signInAs(world, 'buero');
// A bad id or kind never reaches the database.
await assertRefused(
  world,
  [
    ['readInvoiceLineSource bad id', () => leistungLine('not-a-uuid')],
    [
      'readInvoiceLineSource bad kind',
      () =>
        readInvoiceLineSource(JSON.parse('{"kind":"angebot","id":"95000000-0000-4000-8000-000000000001"}')),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Another organization's entry is not found; an entry the office cannot bill today is refused with its reason.
const refusals: Array<[string, () => Promise<unknown>, string]> = [
  ['foreign Leistung', () => leistungLine(leistungIds.foreign), 'source_not_found'],
  ['foreign article', () => articleLine(articleIds.foreign), 'source_not_found'],
  ['article named as a Leistung', () => leistungLine(articleIds.own), 'source_not_found'],
  ['archived Leistung', () => leistungLine(leistungIds.archived), 'source_archived'],
  ['inactive article', () => articleLine(articleIds.inactive), 'source_archived'],
  ['Leistung without a price today', () => leistungLine(leistungIds.unpriced), 'source_unpriced'],
  ['article with a unit outside the list', () => articleLine(articleIds.legacyUnit), 'source_unit_unknown'],
  ['Leistung at 16 %', () => leistungLine(leistungIds.oddRate), 'source_tax_rate_unsupported'],
];
for (const [label, read, error] of refusals) {
  assert.deepEqual(await read(), { success: false, error }, `${label}: the refusal changed`);
}

// Büro's own entries become lines with today's price, read for its own organization.
world.rpcCalls.length = 0;
assert.deepEqual(await leistungLine(leistungIds.own), {
  success: true,
  line: {
    name: 'Monteurstunde',
    description: 'Arbeitszeit Geselle',
    unit: 'hour',
    unitPriceCents: 7250,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
    source: { kind: 'leistung', id: leistungIds.own, number: 'L-7', name: 'Monteurstunde', archived: false },
  },
});
assert.deepEqual(await articleLine(articleIds.own), {
  success: true,
  line: {
    name: 'Kupferrohr 15 mm',
    description: '',
    unit: 'meter',
    unitPriceCents: 1234,
    priceQuantity: 10,
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
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [
    ['leistung_prices_on_day', ORGANIZATION_A],
    ['read_inventory_item_prices_on_day', ORGANIZATION_A],
  ],
);
