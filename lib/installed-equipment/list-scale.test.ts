import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import type { EquipmentListQuery } from './list-page';

// The equipment list read the whole organization and filtered it in the
// browser. The database now selects, filters and counts one page
// (`list_equipment_page`, proven in supabase/tests/service_list_pages.sql);
// this reader hydrates only that page and never turns a failed or malformed
// read into an empty list.
const pageIds = Array.from(
  { length: LIST_PAGE_SIZE },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
);
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = {
  data: null,
  error: null,
};
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let failingTable: string | null = null;
let batchSizes: Record<string, number[]> = {};

const query: EquipmentListQuery = {
  search: 'kessel',
  category: 'ventilation',
  includeArchived: true,
  page: 3,
};

function rowsFor(table: string, ids: readonly string[]): unknown[] {
  if (table === 'installed_equipment') {
    return ids.map((id, index) => ({
      id,
      equipment_number: `A-${id.slice(-4)}`,
      client_id: `client-${index % 7}`,
      site_id: `site-${index % 9}`,
    }));
  }
  if (table === 'installed_equipment_identifiers') {
    return ids.map((equipmentId) => ({
      id: `identifier-${equipmentId}`,
      equipment_id: equipmentId,
      identifier_type: 'serial_number',
      value: equipmentId,
      issuer: null,
    }));
  }
  return ids.map((id) => ({ id, name: id, street: null, postal_code: null, city: null }));
}

const admin = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return rpcResult;
  },
  from: (table: string) => {
    let ids: readonly string[] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      range: () => builder,
      in: (column: string, values: readonly string[]) => {
        ids = values;
        (batchSizes[`${table}.${column}`] ??= []).push(values.length);
        return builder;
      },
      then: (
        resolve: (result: {
          data: unknown[] | null;
          error: { code: string; message: string } | null;
        }) => void,
      ) =>
        resolve(
          table === failingTable
            ? { data: null, error: { code: 'boom', message: 'boom' } }
            : // The page rows arrive in storage order, not in page order.
              { data: rowsFor(table, [...ids].reverse()), error: null },
        ),
    };
    return builder;
  },
};

mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({
  updateTag: () => undefined,
  revalidatePath: () => undefined,
  cacheTag: () => undefined,
}));
mock.module('@/lib/data/cached', () => ({ CACHE_TAGS: {} }));
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: { orgId: 'org', userId: 'user', role: 'admin', isManagerOrAbove: true },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));

const { getInstalledEquipmentPage } = await import('./list-page-server');
const loggedFailures = spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => loggedFailures.mockRestore());

beforeEach(() => {
  rpcResult = { data: { total: 2_345, hasAny: true, ids: pageIds }, error: null };
  rpcCalls = [];
  failingTable = null;
  batchSizes = {};
  loggedFailures.mockClear();
});

test('the database selects the page and the reader hydrates only its rows, in page order', async () => {
  const result = await getInstalledEquipmentPage(query);
  if (!result.success) throw new Error(result.error);
  expect(rpcCalls).toEqual([
    {
      name: 'list_equipment_page',
      args: {
        p_organization_id: 'org',
        p_search: 'kessel',
        p_category: 'ventilation',
        p_include_archived: true,
        p_page: 3,
        p_page_size: LIST_PAGE_SIZE,
      },
    },
  ]);
  expect(result.page.total).toBe(2_345);
  expect(result.page.hasAnyEquipment).toBe(true);
  expect(result.page.equipment.map((item) => item.id)).toEqual(pageIds);
  expect(result.page.equipment.every((item) => item.identifiers.length === 1)).toBe(true);
  const hydratedIds = (key: string): number =>
    (batchSizes[key] ?? []).reduce((total, size) => total + size, 0);
  expect(hydratedIds('installed_equipment.id')).toBe(LIST_PAGE_SIZE);
  expect(hydratedIds('installed_equipment_identifiers.equipment_id')).toBe(LIST_PAGE_SIZE);
  expect(Math.max(...Object.values(batchSizes).flat())).toBeLessThanOrEqual(ID_BATCH_SIZE);
});

test('an empty organization is a successful empty page, not a failure', async () => {
  rpcResult = { data: { total: 0, hasAny: false, ids: [] }, error: null };
  expect(await getInstalledEquipmentPage({ ...query, page: 1 })).toEqual({
    success: true,
    page: { equipment: [], total: 0, hasAnyEquipment: false },
  });
});

test('a failed or malformed page selection fails visibly and is logged', async () => {
  for (const failure of [
    { data: null, error: { code: '57014', message: 'timeout' } },
    { data: { total: 1, hasAny: true, ids: ['not-a-uuid'] }, error: null },
    { data: { total: 1, hasAny: true, ids: [...pageIds, pageIds[0]] }, error: null },
  ]) {
    rpcResult = failure;
    loggedFailures.mockClear();
    expect(await getInstalledEquipmentPage(query)).toEqual({
      success: false,
      error: 'installed_equipment_load_failed',
    });
    expect(loggedFailures).toHaveBeenCalled();
  }
});

test('a failed hydration read fails the page and is logged', async () => {
  for (const table of ['installed_equipment', 'installed_equipment_identifiers', 'client_sites']) {
    failingTable = table;
    loggedFailures.mockClear();
    expect(await getInstalledEquipmentPage(query)).toEqual({
      success: false,
      error: 'installed_equipment_load_failed',
    });
    expect(loggedFailures).toHaveBeenCalled();
  }
});

test('a malformed query is refused before any read', async () => {
  const malformed = { ...query, category: 'boiler' } as unknown as EquipmentListQuery;
  expect(await getInstalledEquipmentPage(malformed)).toEqual({
    success: false,
    error: 'installed_equipment_input_invalid',
  });
  expect(rpcCalls).toEqual([]);
});
