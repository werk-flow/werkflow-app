// The real article save over the in-memory database: a unit outside the unit
// list is refused before the database function runs, empty text is no unit,
// an alias saves as its code, and the database's refusal of a unit change on
// an article with history reaches the form by name.
import assert from 'node:assert/strict';
import { installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const world = installActionWorld({ inventory_items: [] });
const { upsertInventoryItem } = await import('@/lib/inventory/catalog-actions');
const article = (unit: string) => () =>
  upsertInventoryItem({ name: 'Bogen 90° 15 mm', itemType: 'material', unit, isBillable: true });

signInAs(world, 'buero');
await assertRefused(
  world,
  [['unknown unit', article('Bogen')]],
  { success: false, error: 'unit_unknown' },
  'reads',
);
await assertRefused(
  world,
  [['empty unit', article('  ')]],
  { success: false, error: 'unit_required' },
  'reads',
);

world.rpc = ({ args }) => ({ data: { id: 'neu', ...Object(args.p_item) }, error: null });
world.rpcCalls.length = 0;
await upsertInventoryItem({ name: 'Bogen 90° 15 mm', itemType: 'material', unit: 'Stk.', isBillable: true });
const saved = world.rpcCalls[0]?.args.p_item;
assert.equal(typeof saved === 'object' && saved !== null && 'unit' in saved ? saved.unit : null, 'piece');

// The database keeps the unit of an article with stock or history; the save
// passes that refusal on by name, so the form can say why.
world.rpc = () => ({ data: null, error: { message: 'unit_in_use' } });
assert.deepEqual(
  await upsertInventoryItem({
    id: crypto.randomUUID(),
    name: 'Kupferrohr 15 mm',
    itemType: 'material',
    unit: 'Stange',
    isBillable: true,
  }),
  { success: false, error: 'unit_in_use' },
);
