import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import type { ServiceCaseListQuery } from './list-page';

// The service-case list read the whole organization and filtered it in the
// browser. The database now selects, filters and counts one page
// (`list_service_case_page`, proven in supabase/tests/service_list_pages.sql);
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
let equalityFilters: Record<string, string[]> = {};

const query: ServiceCaseListQuery = { search: 'heizung', status: 'visit_required', page: 2 };

function rowsFor(table: string, column: string | null, ids: readonly string[]): unknown[] {
  if (table === 'service_cases' && column === 'id') {
    return ids.map((id, index) => ({
      id,
      case_number: `S-${id.slice(-4)}`,
      client_id: `client-${index % 7}`,
      site_id: `site-${index % 9}`,
      job_id: index % 2 === 0 ? `job-${id}` : null,
    }));
  }
  if (table === 'service_case_equipment_links') {
    return ids.map((caseId) => ({ service_case_id: caseId, equipment_id: `equipment-${caseId}` }));
  }
  if (column === 'id')
    return ids.map((id) => ({ id, name: id, street: null, postal_code: null, city: null }));
  return [];
}

const admin = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return rpcResult;
  },
  from: (table: string) => {
    let column: string | null = null;
    let ids: readonly string[] = [];
    const builder = {
      select: () => builder,
      is: () => builder,
      order: () => builder,
      range: () => builder,
      maybeSingle: async () =>
        table === failingTable
          ? { data: null, error: { code: 'boom', message: 'boom' } }
          : { data: null, error: null },
      eq: (filterColumn: string, value: string) => {
        (equalityFilters[table] ??= []).push(`${filterColumn}=${value}`);
        return builder;
      },
      in: (inColumn: string, values: readonly string[]) => {
        column = inColumn;
        ids = values;
        (batchSizes[`${table}.${inColumn}`] ??= []).push(values.length);
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
              { data: rowsFor(table, column, [...ids].reverse()), error: null },
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
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: { orgId: 'org', userId: 'user', role: 'admin', isManagerOrAbove: true },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));

const { getServiceCaseDetailByNumber, getServiceClientOption } = await import('./actions');
const { getServiceCasePage } = await import('./list-page-server');
const loggedFailures = spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => loggedFailures.mockRestore());

beforeEach(() => {
  rpcResult = { data: { total: 1_234, hasAny: true, ids: pageIds }, error: null };
  rpcCalls = [];
  failingTable = null;
  batchSizes = {};
  equalityFilters = {};
  loggedFailures.mockClear();
});

test('the database selects the page and the reader hydrates only its rows, in page order', async () => {
  const result = await getServiceCasePage(query);
  if (!result.success) throw new Error(result.error);
  expect(rpcCalls).toEqual([
    {
      name: 'list_service_case_page',
      args: {
        p_organization_id: 'org',
        p_status: 'visit_required',
        p_search: 'heizung',
        p_page: 2,
        p_page_size: LIST_PAGE_SIZE,
      },
    },
  ]);
  expect(result.page.total).toBe(1_234);
  expect(result.page.hasAnyCase).toBe(true);
  expect(result.page.cases.map((item) => item.id)).toEqual(pageIds);
  expect(result.page.cases.every((item) => item.equipment.length === 1)).toBe(true);
  const hydratedIds = (key: string): number =>
    (batchSizes[key] ?? []).reduce((total, size) => total + size, 0);
  expect(hydratedIds('service_cases.id')).toBe(LIST_PAGE_SIZE);
  expect(hydratedIds('service_case_equipment_links.service_case_id')).toBe(LIST_PAGE_SIZE);
  expect(Math.max(...Object.values(batchSizes).flat())).toBeLessThanOrEqual(ID_BATCH_SIZE);
});

test('an empty organization is a successful empty page, not a failure', async () => {
  rpcResult = { data: { total: 0, hasAny: false, ids: [] }, error: null };
  expect(await getServiceCasePage({ ...query, page: 1 })).toEqual({
    success: true,
    page: { cases: [], total: 0, hasAnyCase: false },
  });
});

test('a failed or malformed page selection fails visibly and is logged', async () => {
  for (const failure of [
    { data: null, error: { code: '57014', message: 'timeout' } },
    { data: { total: '1', hasAny: true, ids: [] }, error: null },
    { data: { total: 1, hasAny: true, ids: [...pageIds, pageIds[0]] }, error: null },
  ]) {
    rpcResult = failure;
    loggedFailures.mockClear();
    expect(await getServiceCasePage(query)).toEqual({ success: false, error: 'service_case_load_failed' });
    expect(loggedFailures).toHaveBeenCalled();
  }
});

test('a failed hydration read fails the page and is logged', async () => {
  for (const table of ['service_cases', 'service_case_equipment_links', 'clients']) {
    failingTable = table;
    loggedFailures.mockClear();
    expect(await getServiceCasePage(query)).toEqual({ success: false, error: 'service_case_load_failed' });
    expect(loggedFailures).toHaveBeenCalled();
  }
});

test('a malformed query is refused before any read', async () => {
  const malformed = { ...query, status: 'archived' } as unknown as ServiceCaseListQuery;
  expect(await getServiceCasePage(malformed)).toEqual({ success: false, error: 'invalid_input' });
  expect(rpcCalls).toEqual([]);
});

test('the form choices are read for one customer inside the organization', async () => {
  const clientId = '00000000-0000-4000-8000-000000000001';
  const result = await getServiceClientOption(clientId);
  expect(result).toEqual({ success: true, client: null });
  expect(equalityFilters.clients).toEqual(['organization_id=org', `id=${clientId}`]);
  for (const table of ['client_sites', 'client_contacts', 'installed_equipment']) {
    expect(equalityFilters[table]).toEqual(['organization_id=org', `client_id=${clientId}`]);
  }
});

test('a malformed customer id is refused before any read', async () => {
  expect(await getServiceClientOption('not-a-uuid')).toEqual({ success: false, error: 'invalid_input' });
  expect(equalityFilters).toEqual({});
});

test('a failed case lookup is a load failure, while a missing case is not found', async () => {
  expect(await getServiceCaseDetailByNumber('SRV-2026-001')).toEqual({
    success: false,
    error: 'service_case_not_found',
  });
  failingTable = 'service_cases';
  expect(await getServiceCaseDetailByNumber('SRV-2026-001')).toEqual({
    success: false,
    error: 'service_case_load_failed',
  });
  expect(loggedFailures).toHaveBeenCalled();
});
