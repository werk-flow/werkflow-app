import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

// Run in a child process so replaced framework modules cannot leak into other tests.
// Drives the real importInventoryRows against a fake service-role client. Each
// row is one import_inventory_row call (migration 20261004151000), which owns
// matching, the barcode and the stock movement; the fake answers each call
// with the outcome or failure a case names, keyed by the row's name.
const root = resolve(import.meta.dir, '../../..');
type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { code: string; message: string } | null };
let tables: Record<string, Row[]> = {};
let rowCalls: Row[] = [];
let outcomes: Record<string, RpcResult> = {};
let nextId = 0;

class Query {
  private operation: 'insert' | 'update' = 'insert';
  private payload: Row = {};
  private predicates: Array<(row: Row) => boolean> = [];
  constructor(private table: string) {}
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }
  insert(payload: Row): this {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row): this {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }
  async single() {
    return this.execute();
  }
  then(resolveResult: (value: ReturnType<Query['execute']>) => unknown) {
    return Promise.resolve(this.execute()).then(resolveResult);
  }
  execute(): { data: Row | null; error: null } {
    const rows = (tables[this.table] ??= []);
    if (this.operation === 'insert') {
      nextId += 1;
      const row = { id: `${this.table}-${nextId}`, ...this.payload };
      rows.push(row);
      return { data: row, error: null };
    }
    for (const row of rows.filter((candidate) =>
      this.predicates.every((predicate) => predicate(candidate)),
    )) {
      Object.assign(row, this.payload);
    }
    return { data: null, error: null };
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
    context: { orgId: 'org', userId: 'actor', isManagerOrAbove: true },
  }),
}));
mock.module(resolve(root, 'lib/supabase/admin.ts'), () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Row): Promise<RpcResult> => {
      if (name !== 'import_inventory_row') return { data: null, error: null };
      rowCalls.push(args);
      const item = args.p_item as Row;
      return outcomes[String(item.name)] ?? { data: 'imported', error: null };
    },
  }),
}));
const logged: unknown[][] = [];
// Capture the reviewed log sink: only the label and the classification may reach it.
console.error = (...args: unknown[]) => logged.push(args);

const { importInventoryRows } = await import('../../inventory/actions');

function reset(rowOutcomes: Record<string, RpcResult> = {}) {
  tables = {};
  rowCalls = [];
  outcomes = rowOutcomes;
  logged.length = 0;
  nextId = 0;
}

function importRows(rows: Array<Record<string, unknown>>) {
  return importInventoryRows({
    fileName: 'bestand.csv',
    columnMapping: {},
    rows: rows.map((row) => ({ name: 'Rohr', itemType: 'material', ...row })),
  });
}

function batch(): Row | undefined {
  return tables.inventory_import_batches?.[0];
}

// 1. Each row is one call with the server-resolved organization, actor and
//    batch, and the cleaned row values. A row the function reports without a
//    Lager is counted apart; the batch counts it as imported. Nothing but the
//    batch is written outside the function.
reset({ Rohr: { data: 'missing_location', error: null } });
expect(
  await importRows([
    { quantity: 5, locationName: null },
    { name: 'Muffe', quantity: 0, locationName: '  ' },
    {
      name: 'Ventil',
      quantity: 2,
      locationName: ' Hauptlager ',
      barcode: ' 4006381333931 ',
      categoryName: 'Sanitär',
    },
  ]),
).toEqual({ success: true, importedCount: 2, missingLocationCount: 1, failedCount: 0 });
expect(rowCalls).toHaveLength(3);
expect(rowCalls[2]).toMatchObject({
  p_organization_id: 'org',
  p_actor_id: 'actor',
  p_import_batch_id: 'inventory_import_batches-1',
  p_location_name: 'Hauptlager',
  p_barcode: '4006381333931',
  p_category_name: 'Sanitär',
  p_quantity: 2,
  p_reason: 'CSV-Import: bestand.csv',
  p_item: { name: 'Ventil', item_type: 'material', unit: 'piece', is_billable: true },
});
expect(rowCalls[1]).toMatchObject({ p_location_name: null, p_quantity: 0 });
expect(rowCalls[2]?.p_item).not.toHaveProperty('organization_id');
expect(Object.keys(tables)).toEqual(['inventory_import_batches']);
expect(batch()).toMatchObject({ status: 'imported', imported_count: 3, failed_count: 0 });

// 2. A refused row and a row whose call failed are failed rows; the other rows
//    still import. A refusal is no fault and is not logged; a failure logs a
//    fixed label with the classification only.
reset({
  Doppelt: { data: null, error: { code: 'P0001', message: 'barcode_taken' } },
  Defekt: { data: null, error: { code: '57014', message: 'Lesefehler mit Artikel 4711' } },
});
expect(
  await importRows([
    { name: 'Doppelt', barcode: '4006381333931', quantity: 3, locationName: 'Hauptlager' },
    { name: 'Defekt', internalSku: 'SKU-1', quantity: 3, locationName: 'Hauptlager' },
    { name: 'Muffe', quantity: 1, locationName: 'Hauptlager' },
  ]),
).toEqual({ success: true, importedCount: 1, missingLocationCount: 0, failedCount: 2 });
expect(batch()).toMatchObject({ status: 'failed', imported_count: 1, failed_count: 2 });
expect(logged).toEqual([['importInventoryRows: import_inventory_row failed', { code: '57014' }]]);
expect(JSON.stringify(logged)).not.toContain('4711');
