import { expect, mock, test } from 'bun:test';
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';

// A list page asks for the names of every person it shows. One `in()` with
// all ids put them into one query string, which the gateway rejects with 414.
const batchSizes: Record<string, number[]> = {};
const admin = {
  from: (table: string) => {
    let batch: readonly string[] = [];
    const query = {
      select: () => query,
      in: (column: string, ids: readonly string[]) => {
        if (column === 'organization_id') return query;
        batch = ids;
        (batchSizes[table] ??= []).push(ids.length);
        return query;
      },
      then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
        resolve({
          data:
            table === 'profiles'
              ? batch.map((id) => ({ id, first_name: 'Vorname', last_name: id }))
              : batch.map((id) => ({ user_id: id })),
          error: null,
        }),
    };
    return query;
  },
};
const callerClient = {
  from: () => ({ select: () => ({ eq: async () => ({ data: [{ organization_id: 'org' }], error: null }) }) }),
};

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => callerClient }));

const { getProfileNamesVisibleTo } = await import('./queries');

test('profile names for 2,500 people are read in gateway-safe batches', async () => {
  const userIds = Array.from({ length: 2_500 }, (_, index) => `user-${index}`);
  const result = await getProfileNamesVisibleTo('user-0', userIds);
  if (!result.success) throw new Error(result.error);
  const names = result.profiles;
  expect(Object.keys(names)).toHaveLength(2_500);
  expect(names['user-2499']).toEqual({ firstName: 'Vorname', lastName: 'user-2499' });
  for (const table of ['organization_members', 'employee_records', 'profiles']) {
    const sizes = batchSizes[table] ?? [];
    expect(
      sizes.reduce((total, size) => total + size, 0),
      table,
    ).toBe(2_500);
    expect(Math.max(...sizes), table).toBeLessThanOrEqual(ID_BATCH_SIZE);
  }
});
