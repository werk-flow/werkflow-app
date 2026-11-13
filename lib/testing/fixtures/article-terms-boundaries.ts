// The article dialog's supplier and price actions over the in-memory
// database: a field worker is refused before any database access; Büro's
// calls carry the caller's organization and actor, never the client's, so a
// foreign article, supplier or reference is refused by the database function
// (supabase/tests/inventory_article_prices.sql proves those refusals); and an
// article's save leaves its suppliers and prices to their own tabs.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownItemId = '94000000-0000-4000-8000-000000000001';
const foreignItemId = '94000000-0000-4000-8000-000000000002';
const foreignSupplierId = '94000000-0000-4000-8000-000000000003';
const foreignReferenceId = '94000000-0000-4000-8000-000000000004';
const ownSupplierId = '94000000-0000-4000-8000-000000000005';

const world = installActionWorld({ inventory_items: [{ id: ownItemId, organization_id: ORGANIZATION_A }] });
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const { addArticlePrice, removeArticleSupplier, saveArticleSupplier, upsertInventoryItem } = await import(
  '@/lib/inventory/catalog-actions'
);

const supplierInput = (fields: Partial<Parameters<typeof saveArticleSupplier>[0]> = {}) => ({
  itemId: ownItemId,
  referenceId: null,
  supplierId: ownSupplierId,
  supplierName: null,
  supplierArticleNumber: ' NR-4711 ',
  purchaseUnit: 'roll',
  packQuantity: 1,
  baseQuantity: 50,
  isPreferred: true,
  ...fields,
});
const priceInput = (fields: Partial<Parameters<typeof addArticlePrice>[0]> = {}) => ({
  itemId: ownItemId,
  kind: 'purchase' as const,
  amountCents: 61000,
  priceQuantity: 100 as const,
  validFrom: '2026-12-01',
  ...fields,
});

// A field worker never reaches the database.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['saveArticleSupplier', () => saveArticleSupplier(supplierInput())],
    ['removeArticleSupplier', () => removeArticleSupplier({ referenceId: foreignReferenceId })],
    ['addArticlePrice', () => addArticlePrice(priceInput())],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Inputs the database never sees: a fraction of a cent, an unknown unit, a
// conversion of 0, a reference without supplier. The type refuses a price
// quantity outside 1, 10, 100 and 1000; the SQL test proves the database does too.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    ['fraction of a cent', () => addArticlePrice(priceInput({ amountCents: 12.5 }))],
    ['unknown unit', () => saveArticleSupplier(supplierInput({ purchaseUnit: 'Stange' }))],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
await assertRefused(
  world,
  [['conversion of 0', () => saveArticleSupplier(supplierInput({ baseQuantity: 0 }))]],
  { success: false, error: 'invalid_conversion' },
  'none',
);
await assertRefused(
  world,
  [['no supplier', () => saveArticleSupplier(supplierInput({ supplierId: null, supplierName: '  ' }))]],
  { success: false, error: 'supplier_required' },
  'none',
);

// Another organization's article, supplier or reference is refused by the
// function, because the action passes the caller's organization and actor.
refuseForeignIds(
  world,
  new Map([
    [foreignItemId, 'item_not_found'],
    [foreignSupplierId, 'supplier_not_found'],
    [foreignReferenceId, 'supplier_reference_not_found'],
  ]),
  'saved-id',
);
await assertRefused(
  world,
  [
    ['saveArticleSupplier', () => saveArticleSupplier(supplierInput({ itemId: foreignItemId }))],
    ['addArticlePrice', () => addArticlePrice(priceInput({ itemId: foreignItemId }))],
  ],
  { success: false, error: 'item_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['saveArticleSupplier', () => saveArticleSupplier(supplierInput({ supplierId: foreignSupplierId }))]],
  { success: false, error: 'supplier_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [
    ['removeArticleSupplier', () => removeArticleSupplier({ referenceId: foreignReferenceId })],
    ['saveArticleSupplier', () => saveArticleSupplier(supplierInput({ referenceId: foreignReferenceId }))],
  ],
  { success: false, error: 'supplier_reference_not_found' },
  'one-call',
);

// An accepted save passes the caller's organization and actor and the values as the database keeps them.
world.rpcCalls.length = 0;
assert.deepEqual(await saveArticleSupplier(supplierInput({ packQuantity: 1.23456 })), {
  success: true,
  referenceId: 'saved-id',
});
assert.deepEqual(world.rpcCalls[0], {
  name: 'save_inventory_item_supplier',
  args: {
    p_organization_id: ORGANIZATION_A,
    p_actor_id: CALLER_ID,
    p_item_id: ownItemId,
    p_reference_id: null,
    p_supplier_id: ownSupplierId,
    p_supplier_name: null,
    p_supplier_article_number: 'NR-4711',
    p_purchase_unit: 'roll',
    p_pack_quantity: 1.235,
    p_base_quantity: 50,
    p_is_preferred: true,
  },
});
// Bought in the base unit, the conversion is 1 = 1 whatever the form held.
world.rpcCalls.length = 0;
await saveArticleSupplier(supplierInput({ purchaseUnit: null, packQuantity: 3, baseQuantity: 7 }));
assert.equal(world.rpcCalls[0]?.args.p_pack_quantity, 1);
assert.equal(world.rpcCalls[0]?.args.p_base_quantity, 1);
world.rpcCalls.length = 0;
assert.deepEqual(await addArticlePrice(priceInput()), { success: true, priceId: 'saved-id' });
assert.deepEqual(world.rpcCalls[0]?.args, {
  p_organization_id: ORGANIZATION_A,
  p_actor_id: CALLER_ID,
  p_item_id: ownItemId,
  p_kind: 'purchase',
  p_amount_cents: 61000,
  p_price_quantity: 100,
  p_valid_from: '2026-12-01',
});

// Saving an existing article sends no supplier and no price: they change only in their tabs.
world.rpc = () => ({
  data: { id: ownItemId, organization_id: ORGANIZATION_A, item_type: 'material', unit: 'meter' },
  error: null,
});
world.rpcCalls.length = 0;
await upsertInventoryItem({
  id: ownItemId,
  name: 'Kupferrohr 15 mm',
  itemType: 'material',
  unit: 'meter',
  isBillable: true,
  supplierId: foreignSupplierId,
  supplierName: 'Großhandel Nordrohr',
  supplierArticleNumber: 'NR-1',
  purchasePriceCents: 1,
  salePriceCents: 2,
});
const savedItem = world.rpcCalls.find((call) => call.name === 'save_inventory_item')?.args.p_item;
assert.ok(savedItem && typeof savedItem === 'object', 'save_inventory_item received the item');
for (const key of ['supplier_id', 'supplier_article_number', 'purchase_price_cents', 'sale_price_cents']) {
  assert.ok(!Object.hasOwn(savedItem, key), `an existing article's save must not send ${key}`);
}
assert.equal(world.rpcCalls.find((call) => call.name === 'save_inventory_item')?.args.p_supplier_name, null);
