import assert from 'node:assert/strict';
import { mock } from 'bun:test';

type Row = Record<string, unknown>;
const organizationId = 'owned-org';
let failSettings = false;
let failFrom = -1;
const rows: Row[] = [];
const pages: number[] = [];
class Query implements PromiseLike<{ data: Row[]; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private start = 0;
  private end = 999;
  constructor(private table: string) {}
  select(): this { return this; }
  eq(column: string, value: string): this { this.filters.push(row => row[column] === value); return this; }
  gte(column: string, value: string): this { this.filters.push(row => String(row[column]) >= value); return this; }
  lte(column: string, value: string): this { this.filters.push(row => String(row[column]) <= value); return this; }
  order(column: string): this { assert.equal(column, 'closure_date'); return this; }
  range(from: number, to: number): this { this.start = from; this.end = to; return this; }
  async maybeSingle() {
    assert.equal(this.table, 'organization_settings');
    assert.equal(this.filters.every(predicate => predicate({ organization_id: organizationId })), true);
    return { data: { holiday_region: 'BY', holiday_region_history: [{ region: 'BY', effectiveFrom: '2026-01-01T00:00:00Z' }] }, error: failSettings ? { message: 'settings unavailable' } : null };
  }
  then<TResult1 = { data: Row[]; error: { message: string } | null }, TResult2 = never>(fulfilled?: ((value: { data: Row[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null, rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    pages.push(this.start);
    const filtered = rows.filter(row => this.filters.every(predicate => predicate(row))).sort((left, right) => String(left.closure_date).localeCompare(String(right.closure_date)));
    return Promise.resolve({ data: filtered.slice(this.start, Math.min(this.end + 1, this.start + 1000)), error: this.start === failFrom ? { message: 'page unavailable' } : null }).then(fulfilled, rejected);
  }
}
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: (table: string) => new Query(table) }) }));
const { readOrganizationCalendar } = await import('@/lib/personnel/calendar-reader');
for (let index = 0; index < 10001; index++) {
  const date = new Date('2026-01-01T12:00:00Z'); date.setUTCDate(date.getUTCDate() + index);
  rows.push({ id: String(index), organization_id: organizationId, closure_date: date.toISOString().slice(0, 10), label: `closure ${index}` });
}
rows.push({ id: 'foreign', organization_id: 'other-org', closure_date: '2026-01-02', label: 'private' });
const [firstRow] = rows;
const thousandthRow = rows[1000];
assert.ok(firstRow && thousandthRow, 'expected the seeded closure rows');
const dates = { from: String(firstRow.closure_date), to: String(thousandthRow.closure_date) };
const calendar = await readOrganizationCalendar(organizationId, dates);
assert.equal(calendar.closureDays.length, 1001);
assert.deepEqual(pages, [0, 1000]);
assert.equal(calendar.closureDays.some(row => row.id === 'foreign'), false);
assert.equal(calendar.holidayRegion, 'BY');
assert.deepEqual(calendar.holidayRegionHistory, [{ region: 'BY', effectiveFrom: '2026-01-01T00:00:00Z' }]);
failFrom = 1000;
await assert.rejects(readOrganizationCalendar(organizationId, dates), /organization_calendar_read_failed/);
failFrom = -1; failSettings = true;
await assert.rejects(readOrganizationCalendar(organizationId, dates), /organization_calendar_read_failed/);
failSettings = false;
await assert.rejects(readOrganizationCalendar(organizationId), /organization_calendar_read_failed/);
