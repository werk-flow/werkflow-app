// Drives the real previewInventoryImport and bookInventoryImport against the
// in-memory world. The database functions preview_inventory_import and
// book_inventory_import (migration 20261201120000) own create or match, the
// unit check against a matched article and the booking; the action stages the
// file's rows in order, refuses a row without a name or with an empty or
// unknown unit before it reaches the database, and reads the answer.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const world = installActionWorld({});
const logged: unknown[][] = [];
// Capture the reviewed log sink: only the label and the classification may reach it.
console.error = (...args: unknown[]) => logged.push(args);

const { bookInventoryImport, previewInventoryImport } = await import('@/lib/inventory/import-actions');
signInAs(world, 'admin');

const batchId = '92000000-0000-4000-8000-000000000001';
const contentHash = 'c'.repeat(64);
let answer: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null };
world.rpc = ({ name }) => (name === 'ensure_inventory_defaults' ? { data: null, error: null } : answer);

function previewRows(rows: Array<Record<string, unknown>>) {
  return previewInventoryImport({
    fileName: ' nordrohr.csv ',
    contentHash,
    mode: 'master_data',
    columnMapping: { name: 'Bezeichnung', unit: 'Einheit' },
    rows: rows.map((row) => ({ name: 'Kupferrohr 15 mm', itemType: 'material', unit: 'm', ...row })),
  });
}

function previewCall() {
  return world.rpcCalls.find((call) => call.name === 'preview_inventory_import');
}

// 1. Every row is staged in the file's order. A row without a name or with an
//    empty or unknown unit is refused by the action and never read as Stück;
//    a known unit text becomes its unit code. The call carries the caller's
//    organization and actor, the mode, the hash and the mapping.
answer = {
  data: {
    batch_id: batchId,
    rows: [
      {
        index: 0,
        outcome: 'imported',
        matched_by: null,
        item_name: 'Kupferrohr 15 mm',
        unit: 'meter',
        location_name: null,
        location_created: false,
        quantity: 5,
        quantity_before: null,
        quantity_after: null,
      },
      { index: 1, outcome: 'rejected', reason: 'missing_name' },
      { index: 2, outcome: 'rejected', reason: 'unknown_unit' },
      { index: 3, outcome: 'rejected', reason: 'unknown_unit' },
      { index: 4, outcome: 'rejected', reason: 'reason_of_a_newer_release', unit: 'piece' },
    ],
  },
  error: null,
};
const preview = await previewRows([
  { quantity: 5, locationName: ' Hauptlager ', barcode: ' 4000000000015 ', categoryName: 'Rohre' },
  { name: '   ' },
  { unit: 'Fass' },
  { unit: '  ' },
  { name: 'Pressfitting', unit: 'Stk' },
]);
assert.equal(previewCall()?.args.p_organization_id, ORGANIZATION_A);
assert.equal(previewCall()?.args.p_actor_id, CALLER_ID);
assert.deepEqual(
  {
    fileName: previewCall()?.args.p_file_name,
    mode: previewCall()?.args.p_mode,
    hash: previewCall()?.args.p_content_hash,
    mapping: previewCall()?.args.p_column_mapping,
  },
  {
    fileName: 'nordrohr.csv',
    mode: 'master_data',
    hash: contentHash,
    mapping: { name: 'Bezeichnung', unit: 'Einheit' },
  },
);
const staged = previewCall()?.args.p_rows;
assert.ok(Array.isArray(staged), 'the preview must stage the rows as an array');
assert.deepEqual(staged.slice(1, 4), [
  { rejection: 'missing_name' },
  { rejection: 'unknown_unit' },
  { rejection: 'unknown_unit' },
]);
assert.deepEqual(staged[0], {
  item: {
    item_type: 'material',
    name: 'Kupferrohr 15 mm',
    unit: 'meter',
    internal_sku: null,
    manufacturer: null,
    supplier_article_number: null,
    purchase_price_cents: null,
    sale_price_cents: null,
    is_billable: true,
    global_minimum_stock: 0,
    global_target_stock: null,
    notes: null,
  },
  category_name: 'Rohre',
  supplier_name: null,
  location_name: 'Hauptlager',
  barcode: '4000000000015',
  quantity: 5,
});
assert.equal(
  typeof staged[4] === 'object' && staged[4] !== null && 'item' in staged[4]
    ? JSON.stringify(staged[4].item)
    : '',
  JSON.stringify({ ...staged[0].item, name: 'Pressfitting', unit: 'piece' }),
);

// 2. The answer reads as one outcome per row; a reason this release does not
//    know reads as a failed row instead of failing the preview.
assert.ok(preview.success, 'the preview must succeed');
assert.equal(preview.batchId, batchId);
assert.deepEqual(preview.rows[0], {
  index: 0,
  outcome: 'imported',
  matchedBy: null,
  itemName: 'Kupferrohr 15 mm',
  unit: 'meter',
  locationName: null,
  locationCreated: false,
  quantity: 5,
  quantityAfter: null,
  reason: null,
  itemUnit: null,
});
assert.deepEqual(
  preview.rows.map((row) => row.reason),
  [null, 'missing_name', 'unknown_unit', 'unknown_unit', 'failed'],
);

// 3. A refusal passes through unlogged; a failure logs a fixed label with the
//    classification only, never a row value.
world.rpcCalls.length = 0;
answer = { data: null, error: { code: 'P0001', message: 'not_authorized' } };
assert.deepEqual(await previewRows([{}]), { success: false, error: 'not_authorized' });
answer = { data: null, error: { code: '57014', message: 'Lesefehler bei Kupferrohr 15 mm' } };
assert.deepEqual(await previewRows([{}]), { success: false, error: 'save_failed' });
assert.deepEqual(logged, [['previewInventoryImport: preview failed', { code: '57014' }]]);
assert.ok(!JSON.stringify(logged).includes('Kupferrohr'));

// 4. The booking names only the batch; a repeated confirm answers the first
//    booking's rows and says so.
world.rpcCalls.length = 0;
answer = {
  data: { already_booked: true, rows: [{ index: 0, outcome: 'booked', matched_by: 'barcode' }] },
  error: null,
};
const booking = await bookInventoryImport({ batchId });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args]),
  [
    [
      'book_inventory_import',
      { p_organization_id: ORGANIZATION_A, p_actor_id: CALLER_ID, p_import_batch_id: batchId },
    ],
  ],
);
assert.ok(booking.success, 'the booking must succeed');
assert.equal(booking.alreadyBooked, true);
assert.equal(booking.rows[0]?.matchedBy, 'barcode');
