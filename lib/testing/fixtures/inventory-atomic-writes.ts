import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

// Run in a child process so replaced framework modules cannot leak into other tests.
// Drives the real upsertInventoryItem, takeJobMaterial and takeProjectMaterial
// against a fake service-role client: each save or unplanned take is one
// database function call with the server-resolved organization and actor, no
// direct table write follows it, and the function's refusal codes reach the
// caller.
const root = resolve(import.meta.dir, '../../..');
type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { code: string; message: string } | null };
type RpcCall = { name: string; args: Row };

const ORG = 'org';
const ACTOR = 'actor';
const ITEM = '00000000-0000-4000-8000-0000000000b1';
const LOCATION = '00000000-0000-4000-8000-0000000000b2';
const CATEGORY = '00000000-0000-4000-8000-0000000000b3';
const JOB = '00000000-0000-4000-8000-0000000000b4';
const FOREIGN_JOB = '00000000-0000-4000-8000-0000000000b5';
const PROJECT = '00000000-0000-4000-8000-0000000000b6';

let tables: Record<string, Row[]> = {};
let tableWrites = 0;
let rpcCalls: RpcCall[] = [];
let rpcResult: RpcResult = { data: null, error: null };
let manager = true;

class Query {
  private predicates: Array<(row: Row) => boolean> = [];
  constructor(private table: string) {}
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: unknown): this {
    return this.eq(column, value);
  }
  insert(): this {
    tableWrites += 1;
    return this;
  }
  update(): this {
    tableWrites += 1;
    return this;
  }
  delete(): this {
    tableWrites += 1;
    return this;
  }
  async maybeSingle() {
    const rows = (tables[this.table] ?? []).filter((row) =>
      this.predicates.every((predicate) => predicate(row)),
    );
    return { data: rows[0] ?? null, error: null };
  }
}

mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module(resolve(root, 'lib/data/cached.ts'), () => ({
  CACHE_TAGS: { inventory: () => 'inventory', jobs: () => 'jobs', projects: () => 'projects' },
}));
mock.module(resolve(root, 'lib/jobs/auth.ts'), () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: { orgId: ORG, userId: ACTOR, isManagerOrAbove: manager },
  }),
}));
mock.module(resolve(root, 'lib/supabase/admin.ts'), () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));
const logged: unknown[][] = [];
// Capture the reviewed log sink: only the label and the classification may reach it.
console.error = (...args: unknown[]) => logged.push(args);

const { takeJobMaterial, takeProjectMaterial, upsertInventoryItem } = await import('../../inventory/actions');

function reset(result: RpcResult, { isManager = true }: { isManager?: boolean } = {}) {
  tables = {
    jobs: [{ id: JOB, organization_id: ORG, project_id: PROJECT }],
    job_assignments: [],
    projects: [{ id: PROJECT, organization_id: ORG }],
  };
  tableWrites = 0;
  rpcCalls = [];
  rpcResult = result;
  manager = isManager;
  logged.length = 0;
}

const savedRow = {
  id: ITEM,
  organization_id: ORG,
  name: 'Kupferrohr',
  item_type: 'material',
  unit: 'meter',
  is_billable: true,
  global_minimum_stock: 0,
  track_quantity: true,
  track_individual_assets: false,
  is_active: true,
};
const refusal = (message: string): RpcResult => ({ data: null, error: { code: 'P0001', message } });
const createInput = {
  name: ' Kupferrohr ',
  itemType: 'material' as const,
  unit: 'm',
  isBillable: true,
  categoryId: CATEGORY,
  barcode: ' 4006381333931 ',
  initialLocationId: LOCATION,
  initialQuantity: 5,
};

// 1. A create is one save_inventory_item call: the organization and actor come
//    from the server, the item payload carries neither, and the barcode and
//    the first count travel in the same call. No table write follows.
reset({ data: savedRow, error: null });
const created = await upsertInventoryItem(createInput);
expect(created).toMatchObject({ success: true, item: { id: ITEM, name: 'Kupferrohr' } });
expect(rpcCalls).toHaveLength(1);
expect(rpcCalls[0]).toMatchObject({
  name: 'save_inventory_item',
  args: {
    p_organization_id: ORG,
    p_actor_id: ACTOR,
    p_item_id: null,
    p_barcode: '4006381333931',
    p_initial_location_id: LOCATION,
    p_initial_quantity: 5,
    p_item: { name: 'Kupferrohr', unit: 'meter', category_id: CATEGORY },
  },
});
expect(rpcCalls[0]?.args.p_item).not.toHaveProperty('organization_id');
expect(rpcCalls[0]?.args.p_item).not.toHaveProperty('created_by');
expect(tableWrites).toBe(0);

// 2. An edit never books a first count.
reset({ data: savedRow, error: null });
expect(
  (await upsertInventoryItem({ ...createInput, id: ITEM, initialLocationId: null, initialQuantity: 0 }))
    .success,
).toBe(true);
expect(rpcCalls[0]?.args).toMatchObject({
  p_item_id: ITEM,
  p_initial_location_id: null,
  p_initial_quantity: 0,
});

// 3. The function's refusals reach the caller as their code, unlogged; the
//    ledger's refusals keep their existing codes; anything else is save_failed
//    with only the classification logged.
for (const [result, expected] of [
  [refusal('category_not_found'), 'category_not_found'],
  [refusal('barcode_taken'), 'barcode_taken'],
  [refusal('supplier_not_found'), 'supplier_not_found'],
  [refusal('item_not_found'), 'item_not_found'],
  [refusal('not_authorized'), 'not_authorized'],
  [refusal('inventory item is not available for stock movement'), 'movement_failed'],
  [{ data: null, error: { code: '23505', message: 'duplicate key Artikel 4711' } }, 'save_failed'],
] as const) {
  reset(result);
  expect(await upsertInventoryItem(createInput)).toEqual({ success: false, error: expected });
  expect(tableWrites).toBe(0);
  expect(JSON.stringify(logged)).not.toContain('4711');
}
expect(logged).toEqual([['upsertInventoryItem: save_inventory_item failed', { code: '23505' }]]);

// 4. An employee never reaches the function.
reset({ data: savedRow, error: null }, { isManager: false });
expect(await upsertInventoryItem(createInput)).toEqual({ success: false, error: 'not_authorized' });
expect(rpcCalls).toEqual([]);

// 5. An unplanned job take is one take_unplanned_inventory_material call; the
//    function reads the job's project itself. A refused take writes no line
//    and deletes nothing.
const takeInput = { jobId: JOB, itemId: ITEM, locationId: LOCATION, quantity: 2 };
reset({ data: 3, error: null });
expect(await takeJobMaterial(takeInput)).toEqual({ success: true, quantityAfter: 3 });
expect(rpcCalls).toEqual([
  {
    name: 'take_unplanned_inventory_material',
    args: {
      p_organization_id: ORG,
      p_actor_id: ACTOR,
      p_job_id: JOB,
      p_project_id: null,
      p_item_id: ITEM,
      p_location_id: LOCATION,
      p_quantity: 2,
      p_reason: 'Für Auftrag entnommen',
      p_notes: null,
    },
  },
]);
expect(tableWrites).toBe(0);

reset(refusal('inventory stock cannot go below zero'));
expect(await takeJobMaterial(takeInput)).toEqual({ success: false, error: 'stock_would_go_negative' });
expect(tableWrites).toBe(0);

reset(refusal('location_not_found'));
expect(await takeJobMaterial(takeInput)).toEqual({ success: false, error: 'location_not_found' });

// 6. A foreign job never reaches the function; an unassigned employee neither,
//    an assigned one does.
reset({ data: 3, error: null });
expect(await takeJobMaterial({ ...takeInput, jobId: FOREIGN_JOB })).toEqual({
  success: false,
  error: 'job_not_found',
});
reset({ data: 3, error: null }, { isManager: false });
expect(await takeJobMaterial(takeInput)).toEqual({ success: false, error: 'not_authorized' });
expect(rpcCalls).toEqual([]);
reset({ data: 1, error: null }, { isManager: false });
tables.job_assignments = [{ id: 'assignment', organization_id: ORG, job_id: JOB, user_id: ACTOR }];
expect(await takeJobMaterial({ ...takeInput, reason: 'Nachgekauft' })).toEqual({
  success: true,
  quantityAfter: 1,
});
expect(rpcCalls[0]?.args).toMatchObject({ p_reason: 'Nachgekauft', p_notes: 'Nachgekauft' });

// 7. An unplanned project take names only the project.
reset({ data: 4, error: null });
expect(
  await takeProjectMaterial({ projectId: PROJECT, itemId: ITEM, locationId: LOCATION, quantity: 1 }),
).toEqual({
  success: true,
  quantityAfter: 4,
});
expect(rpcCalls[0]?.args).toMatchObject({
  p_job_id: null,
  p_project_id: PROJECT,
  p_reason: 'Für Projekt entnommen',
});
expect(tableWrites).toBe(0);
