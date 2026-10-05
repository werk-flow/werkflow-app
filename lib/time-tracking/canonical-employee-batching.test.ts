import { beforeEach, expect, mock, test } from 'bun:test';
import { ID_BATCH_SIZE, LIST_ROW_CAP, ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';

// The correction timeline and the calendar pass every affected user to this
// reader. Both id lists (users, then their employee records) went into one
// query string each; the gateway rejects that with 414 at about 200 ids.
// Without a user list the reader pages the organization's employee records,
// because PostgREST answers at most 1,000 rows and reports no error.
let organizationEmployees = 0;
let batchSizes: Record<string, number[]>;
let employeePages: number[];
const admin = {
  from: (table: string) => {
    let batch: readonly string[] | null = null;
    const query = {
      select: () => query,
      eq: () => query,
      not: () => query,
      lte: () => query,
      or: () => query,
      order: () => query,
      in: (_column: string, ids: readonly string[]) => {
        batch = ids;
        (batchSizes[table] ??= []).push(ids.length);
        return query;
      },
      range: async (from: number, to: number) => {
        if (table !== 'employee_records') return { data: [], error: null };
        if (batch)
          return { data: batch.map((userId) => ({ id: `record-${userId}`, user_id: userId })), error: null };
        employeePages.push(from);
        const length = Math.max(0, Math.min(to + 1, organizationEmployees) - from);
        return {
          data: Array.from({ length }, (_, index) => ({
            id: `record-${from + index}`,
            user_id: `user-${from + index}`,
          })),
          error: null,
        };
      },
    };
    return query;
  },
};

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));

const { getCanonicalTimeEntries } = await import('./canonical-entries');
const window = { organizationId: 'org', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' };

function expectGatewaySafeBatches(table: string, total: number): void {
  const sizes = batchSizes[table] ?? [];
  expect(
    sizes.reduce((sum, size) => sum + size, 0),
    table,
  ).toBe(total);
  expect(Math.max(...sizes), table).toBeLessThanOrEqual(ID_BATCH_SIZE);
}

beforeEach(() => {
  batchSizes = {};
  employeePages = [];
});

test('205 users and their employee records are read in gateway-safe batches', async () => {
  const userIds = Array.from({ length: 205 }, (_, index) => `user-${index}`);
  expect(await getCanonicalTimeEntries({ ...window, userIds })).toEqual({ success: true, entries: [] });
  expectGatewaySafeBatches('employee_records', 205);
  expectGatewaySafeBatches('time_segments', 205);
});

test('2,500 employee records are read across pages and all of them reach the segment read', async () => {
  organizationEmployees = 2_500;
  expect(await getCanonicalTimeEntries(window)).toEqual({ success: true, entries: [] });
  expect(employeePages).toEqual([0, ROW_PAGE_SIZE, 2 * ROW_PAGE_SIZE]);
  expectGatewaySafeBatches('time_segments', 2_500);
});

test('more employee records than the declared bound fail visibly instead of reading a part', async () => {
  organizationEmployees = LIST_ROW_CAP + 1;
  const logged = mock(() => {});
  const originalError = console.error;
  console.error = logged;
  try {
    expect(await getCanonicalTimeEntries(window)).toEqual({ success: false, error: 'load_failed' });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(batchSizes['time_segments']).toBeUndefined();
  } finally {
    console.error = originalError;
  }
});
