import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const records = [
  { id: 'employee-one', user_id: 'one', organization_id: 'owned' },
  { id: 'employee-two', user_id: 'two', organization_id: 'owned' },
  { id: 'employee-other', user_id: 'other', organization_id: 'owned' },
  { id: 'foreign', user_id: 'one', organization_id: 'foreign' },
];
let reads = 0;
let expectedEmployeeIds: string[] = [];
class Query {
  private filters = new Map<string, readonly string[]>();
  constructor(private table: string) {}
  select(): this {
    return this;
  }
  eq(column: string, value: string): this {
    this.filters.set(column, [value]);
    return this;
  }
  in(column: string, values: string[]): this {
    this.filters.set(column, values);
    return this;
  }
  not(): this {
    return this;
  }
  order(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  or(): this {
    return this;
  }
  async range(): Promise<{ data: typeof records; error: null }> {
    reads += 1;
    expect(this.filters.get('organization_id')).toEqual(['owned']);
    if (this.table === 'time_segments') {
      expect(this.filters.get('employee_record_id')).toEqual(expectedEmployeeIds);
      return { data: [], error: null };
    }
    const users = this.filters.get('user_id');
    return {
      data: records.filter(
        (row) => row.organization_id === 'owned' && (!users || users.includes(row.user_id)),
      ),
      error: null,
    };
  }
}
mock.module('server-only', () => ({}));
mock.module(resolve(root, 'lib/supabase/admin.ts'), () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => new Query(table) }),
}));
const { getCanonicalTimeEntries } = await import('../../time-tracking/canonical-entries');
const input = { organizationId: 'owned', from: '2026-09-30T00:00:00Z', to: '2026-10-01T00:00:00Z' };
expectedEmployeeIds = ['employee-one', 'employee-two'];
expect(await getCanonicalTimeEntries({ ...input, userIds: ['one', 'two'] })).toEqual({
  success: true,
  entries: [],
});
expectedEmployeeIds = ['employee-one'];
expect(await getCanonicalTimeEntries({ ...input, userId: 'one' })).toEqual({ success: true, entries: [] });
expectedEmployeeIds = ['employee-one', 'employee-two', 'employee-other'];
expect(await getCanonicalTimeEntries(input)).toEqual({ success: true, entries: [] });
const beforeEmpty = reads;
expect(await getCanonicalTimeEntries({ ...input, userIds: [] })).toEqual({ success: true, entries: [] });
expect(reads).toBe(beforeEmpty);
