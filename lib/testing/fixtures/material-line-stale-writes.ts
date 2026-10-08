// The real updateJobMaterialLine and deleteJobMaterialLine over the in-memory
// database: a decision made on a material line that changed before the write
// lands (a movement booked, the line removed) changes nothing and answers with
// the refusal code; the same calls on an unchanged line succeed.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';

const oldItemId = '00000000-0000-4000-8000-0000000000f1';
const newItemId = '00000000-0000-4000-8000-0000000000f2';
const lineIds = {
  swapRaced: '00000000-0000-4000-8000-0000000000a1',
  editRaced: '00000000-0000-4000-8000-0000000000a2',
  swap: '00000000-0000-4000-8000-0000000000a3',
  deleteRaced: '00000000-0000-4000-8000-0000000000a4',
  cancelRaced: '00000000-0000-4000-8000-0000000000a5',
  delete: '00000000-0000-4000-8000-0000000000a6',
  cancel: '00000000-0000-4000-8000-0000000000a7',
} as const;
const lineRow = (id: string, takenQuantity: number): Record<string, unknown> => ({
  id,
  organization_id: ORGANIZATION_A,
  job_id: '00000000-0000-4000-8000-0000000000b1',
  project_id: null,
  item_id: oldItemId,
  planned_quantity: 4,
  taken_quantity: takenQuantity,
  returned_quantity: 0,
  is_billable: true,
  status: 'planned',
});

const world = installActionWorld({
  job_material_lines: [
    lineRow(lineIds.swapRaced, 0),
    lineRow(lineIds.editRaced, 0),
    lineRow(lineIds.swap, 0),
    lineRow(lineIds.deleteRaced, 0),
    lineRow(lineIds.cancelRaced, 2),
    lineRow(lineIds.delete, 0),
    lineRow(lineIds.cancel, 2),
  ],
  inventory_items: [{ id: newItemId, organization_id: ORGANIZATION_A, is_billable: false }],
});
const { deleteJobMaterialLine, updateJobMaterialLine } = await import('@/lib/inventory/actions');

const line = (id: string): Record<string, unknown> | undefined =>
  tableRows(world, 'job_material_lines').find((row) => row.id === id);
/** The next write first applies `change` to the line, as a concurrent request would. */
const raceOn = (id: string, change: (row: Record<string, unknown>) => void): void => {
  world.beforeNextWrite = (table) => {
    assert.equal(table, 'job_material_lines');
    const row = line(id);
    assert.ok(row);
    change(row);
  };
};
const removeLine = (id: string): void => {
  world.tables.job_material_lines = tableRows(world, 'job_material_lines').filter((row) => row.id !== id);
};
const assertReachedWrite = (): void =>
  assert.equal(world.beforeNextWrite, null, 'the action reached its write');
signInAs(world, 'buero');

// An item swap checked against a line without movements: a take booked before
// the write keeps the old item.
raceOn(lineIds.swapRaced, (row) => {
  row.taken_quantity = 2;
});
assert.deepEqual(await updateJobMaterialLine({ lineId: lineIds.swapRaced, itemId: newItemId }), {
  success: false,
  error: 'line_has_movements',
});
assertReachedWrite();
assert.equal(line(lineIds.swapRaced)?.item_id, oldItemId);

// An edit of a line removed before the write answers line_not_found.
raceOn(lineIds.editRaced, () => removeLine(lineIds.editRaced));
assert.deepEqual(await updateJobMaterialLine({ lineId: lineIds.editRaced, plannedQuantity: 6 }), {
  success: false,
  error: 'line_not_found',
});
assertReachedWrite();
assert.equal(line(lineIds.editRaced), undefined);

// The swap on an unchanged line succeeds and takes the new item's billing flag.
assert.deepEqual(await updateJobMaterialLine({ lineId: lineIds.swap, itemId: newItemId }), {
  success: true,
  lineId: lineIds.swap,
});
assert.deepEqual([line(lineIds.swap)?.item_id, line(lineIds.swap)?.is_billable], [newItemId, false]);

// A deletion decided on a line without movements: a take booked before the
// write keeps the line, which now has a ledger.
raceOn(lineIds.deleteRaced, (row) => {
  row.taken_quantity = 1;
});
assert.deepEqual(await deleteJobMaterialLine(lineIds.deleteRaced), { success: false, error: 'line_changed' });
assertReachedWrite();
assert.deepEqual(
  [line(lineIds.deleteRaced)?.taken_quantity, line(lineIds.deleteRaced)?.status],
  [1, 'planned'],
);

// A cancellation decided on a line with movements: the line removed before the write answers line_changed.
raceOn(lineIds.cancelRaced, () => removeLine(lineIds.cancelRaced));
assert.deepEqual(await deleteJobMaterialLine(lineIds.cancelRaced), { success: false, error: 'line_changed' });
assertReachedWrite();

// On unchanged lines a line without movements is deleted and one with movements is cancelled.
assert.deepEqual(await deleteJobMaterialLine(lineIds.delete), { success: true });
assert.equal(line(lineIds.delete), undefined);
assert.deepEqual(await deleteJobMaterialLine(lineIds.cancel), { success: true });
assert.equal(line(lineIds.cancel)?.status, 'cancelled');
