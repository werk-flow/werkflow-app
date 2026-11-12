// The real Leistung actions and the Leistung price reader over the in-memory
// database: a field worker is refused before any database access, a foreign
// organization's Leistung is never changed or priced, and the office's writes
// carry its own organization and actor. supabase/tests/leistung_prices.sql
// proves the grants, the history guard and the price on a day.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownLeistungId = '92000000-0000-4000-8000-000000000001';
const archivedLeistungId = '92000000-0000-4000-8000-000000000002';
const foreignLeistungId = '92000000-0000-4000-8000-000000000009';

const leistung = (id: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id,
  organization_id: organizationId,
  leistung_number: 'L-100',
  name: 'Montage Heizung',
  description: '',
  kind: 'arbeit',
  unit: 'hour',
  tax_rate_basis_points: 1900,
  archived_at: null,
  ...fields,
});
const version = (
  id: string,
  leistungId: string,
  organizationId: string,
  validFrom: string,
  sale: number,
) => ({
  id,
  organization_id: organizationId,
  leistung_id: leistungId,
  valid_from: validFrom,
  sale_price_cents: sale,
  cost_rate_cents: 4200,
});

const world = installActionWorld({
  leistungen: [
    leistung(ownLeistungId, ORGANIZATION_A),
    leistung(archivedLeistungId, ORGANIZATION_A, {
      leistung_number: 'L-300',
      archived_at: '2026-11-01T08:00:00Z',
    }),
    leistung(foreignLeistungId, ORGANIZATION_B),
  ],
  leistung_price_versions: [
    version('93000000-0000-4000-8000-000000000001', ownLeistungId, ORGANIZATION_A, '2026-01-01', 6500),
    version('93000000-0000-4000-8000-000000000002', archivedLeistungId, ORGANIZATION_A, '2026-01-01', 5000),
    version('93000000-0000-4000-8000-000000000009', foreignLeistungId, ORGANIZATION_B, '2026-01-01', 9900),
  ],
});

// `add_leistung_price` answered from the world's tables: an active Leistung of the named
// organization gets the version; the SQL test proves the lock and the refusals.
function addLeistungPriceInWorld(args: Record<string, unknown>) {
  const target = tableRows(world, 'leistungen').find(
    (row) =>
      row.id === args.p_leistung_id &&
      row.organization_id === args.p_organization_id &&
      row.archived_at === null,
  );
  if (!target) return { data: null, error: { code: 'P0001', message: 'leistung_not_found' } };
  tableRows(world, 'leistung_price_versions').push({
    id: '93000000-0000-4000-8000-0000000000aa',
    organization_id: args.p_organization_id,
    leistung_id: args.p_leistung_id,
    valid_from: args.p_valid_from,
    sale_price_cents: args.p_sale_price_cents,
    cost_rate_cents: args.p_cost_rate_cents,
    created_by: args.p_actor_id,
  });
  return { data: '93000000-0000-4000-8000-0000000000aa', error: null };
}

// `leistung_prices_on_day` answered from the world's tables for the organization the call names.
// The SQL test owns the choice of the version on a day; here each Leistung has one.
world.rpc = ({ name, args }) => {
  if (name === 'add_leistung_price') return addLeistungPriceInWorld(args);
  if (name !== 'leistung_prices_on_day') return { data: 'created-id', error: null };
  const ids = Array.isArray(args.p_leistung_ids) ? args.p_leistung_ids : [];
  const rows = tableRows(world, 'leistungen')
    .filter((row) => row.organization_id === args.p_organization_id && ids.includes(row.id))
    .map((row) => {
      const price = tableRows(world, 'leistung_price_versions').find((v) => v.leistung_id === row.id);
      return {
        leistung_id: row.id,
        unit: row.unit,
        tax_rate_basis_points: row.tax_rate_basis_points,
        price_version_id: price?.id ?? null,
        valid_from: price?.valid_from ?? null,
        sale_price_cents: price?.sale_price_cents ?? null,
        cost_rate_cents: price?.cost_rate_cents ?? null,
      };
    });
  return { data: rows, error: null };
};

const { addLeistungPrice, createLeistung, setLeistungArchived, updateLeistung } = await import(
  '@/lib/price-catalog/actions'
);
const { readLeistungPrices } = await import('@/lib/price-catalog/leistung-prices');

const fields = {
  leistungNumber: 'L-500',
  name: 'Wartung Gastherme',
  description: 'Jährliche Wartung',
  kind: 'pauschale',
  unit: 'flat_rate',
  taxRateBasisPoints: 1900,
} as const;
const price = { validFrom: '2026-12-01', salePriceCents: 18900, costRateCents: 9500 };

// A field worker never creates, changes or reads a Leistung or its price.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['createLeistung', () => createLeistung({ ...fields, ...price })],
    ['updateLeistung', () => updateLeistung({ ...fields, leistungId: ownLeistungId })],
    ['addLeistungPrice', () => addLeistungPrice({ ...price, leistungId: ownLeistungId })],
    ['setLeistungArchived', () => setLeistungArchived({ leistungId: ownLeistungId, archived: true })],
    ['readLeistungPrices', () => readLeistungPrices([ownLeistungId], '2026-11-12')],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's Leistung is neither changed, priced, archived nor read.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    ['updateLeistung foreign', () => updateLeistung({ ...fields, leistungId: foreignLeistungId })],
    [
      'setLeistungArchived foreign',
      () => setLeistungArchived({ leistungId: foreignLeistungId, archived: true }),
    ],
    ['updateLeistung archived', () => updateLeistung({ ...fields, leistungId: archivedLeistungId })],
  ],
  { success: false, error: 'leistung_not_found' },
  'reads',
);
await assertRefused(
  world,
  [
    ['addLeistungPrice foreign', () => addLeistungPrice({ ...price, leistungId: foreignLeistungId })],
    ['addLeistungPrice archived', () => addLeistungPrice({ ...price, leistungId: archivedLeistungId })],
  ],
  { success: false, error: 'leistung_not_found' },
  'one-call',
);
assert.deepEqual(await readLeistungPrices([foreignLeistungId], '2026-11-12'), { success: true, prices: [] });

// A unit outside E1's list, a tax rate outside the offered ones, a negative price and a bad id never reach the database.
await assertRefused(
  world,
  [
    ['createLeistung unknown unit', () => createLeistung({ ...fields, ...price, unit: 'Bogen' })],
    // A client can send any number; the type of the input knows only the offered rates.
    [
      'createLeistung odd tax rate',
      () => createLeistung(Object.assign({ ...fields, ...price }, { taxRateBasisPoints: 1600 })),
    ],
    [
      'addLeistungPrice negative',
      () => addLeistungPrice({ ...price, salePriceCents: -1, leistungId: ownLeistungId }),
    ],
    [
      'addLeistungPrice bad day',
      () => addLeistungPrice({ ...price, validFrom: '01.12.2026', leistungId: ownLeistungId }),
    ],
    ['readLeistungPrices bad id', () => readLeistungPrices(['not-a-uuid'], '2026-11-12')],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Büro creates in its own organization, as itself, in one database call.
world.rpcCalls.length = 0;
assert.deepEqual(await createLeistung({ ...fields, ...price }), { success: true, leistungId: 'created-id' });
assert.equal(world.rpcCalls.length, 1);
assert.equal(world.rpcCalls[0]?.name, 'create_leistung');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
assert.equal(world.rpcCalls[0]?.args.p_actor_id, CALLER_ID);

// Büro prices, changes and archives its own Leistung; the new version names its organization.
assert.deepEqual(await addLeistungPrice({ ...price, leistungId: ownLeistungId }), { success: true });
const added = tableRows(world, 'leistung_price_versions').filter((row) => row.leistung_id === ownLeistungId);
assert.equal(added.length, 2);
assert.deepEqual(
  { organization: added[1]?.organization_id, sale: added[1]?.sale_price_cents, by: added[1]?.created_by },
  { organization: ORGANIZATION_A, sale: 18900, by: CALLER_ID },
);
assert.deepEqual(await updateLeistung({ ...fields, leistungId: ownLeistungId }), { success: true });
assert.equal(
  tableRows(world, 'leistungen').find((row) => row.id === ownLeistungId)?.name,
  'Wartung Gastherme',
);
assert.deepEqual(await setLeistungArchived({ leistungId: ownLeistungId, archived: true }), { success: true });
const archivedAt = tableRows(world, 'leistungen').find((row) => row.id === ownLeistungId)?.archived_at;
assert.ok(typeof archivedAt === 'string');

// Admin reads the prices of its own Leistungen, archived ones included, with the cost rate.
signInAs(world, 'admin');
const prices = await readLeistungPrices([foreignLeistungId, ownLeistungId, archivedLeistungId], '2026-11-12');
assert.ok(prices.success);
assert.deepEqual(
  prices.prices.map((entry) => [entry.leistungId, entry.salePrice?.amountCents, entry.costRate?.amountCents]),
  [
    [ownLeistungId, 6500, 4200],
    [archivedLeistungId, 5000, 4200],
  ],
);
assert.deepEqual(prices.prices[0], {
  leistungId: ownLeistungId,
  unit: 'flat_rate',
  costRate: { amountCents: 4200, priceQuantity: 1 },
  salePrice: { amountCents: 6500, priceQuantity: 1 },
  taxRateBasisPoints: 1900,
  priceDate: '2026-01-01',
  priceVersionId: '93000000-0000-4000-8000-000000000001',
  source: 'leistung',
});
