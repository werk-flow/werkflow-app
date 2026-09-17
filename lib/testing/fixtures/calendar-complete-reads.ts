// Actual action readers against a PostgREST seam that enforces its 1,000-row response cap.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

type Row = Record<string, unknown>;
type ReadResult = { data: Row[]; error: { message: string } | null };
const organizationId = '10000000-0000-4000-8000-000000000001';
const callerId = 'caller';
let role: 'admin' | 'employee' = 'admin';
let authenticated = true;
let failTable = '';
let failFrom = 0;
let correctionFailure = false;
let provisionalFailure = false;
const tables: Record<string, Row[]> = {};
const calls: Array<{ table: string; from: number }> = [];
let legacyBarrier: Promise<void> | undefined;
const startedProjections = new Set<string>();

class Query implements PromiseLike<ReadResult> {
  private predicates: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private from = 0;
  private to = 999;
  constructor(private table: string) {}
  select(): this { return this; }
  eq(column: string, value: unknown): this { this.predicates.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]): this {
    if (column === 'id' || column === 'employee_record_id') assert.ok(values.length <= 100, 'reference queries must batch their IDs');
    this.predicates.push((row) => values.includes(row[column])); return this;
  }
  not(column: string, operator: string, value: unknown): this {
    assert.equal(operator, 'is'); this.predicates.push((row) => row[column] !== value); return this;
  }
  gte(column: string, value: string): this { this.predicates.push((row) => row[column] != null && String(row[column]) >= value); return this; }
  lte(column: string, value: string): this { this.predicates.push((row) => row[column] != null && String(row[column]) <= value); return this; }
  or(expression: string): this {
    const clauses = expression.split(',').map((clause) => {
      const [column, operator, ...rest] = clause.split('.');
      assert.ok(column !== undefined, `malformed or() clause: ${clause}`);
      const value = rest.join('.');
      return (row: Row): boolean => operator === 'is' ? row[column] === null : row[column] != null && String(row[column]) >= value;
    });
    this.predicates.push((row) => clauses.some((clause) => clause(row))); return this;
  }
  order(column: string, options?: { ascending: boolean }): this { this.orders.push({ column, ascending: options?.ascending ?? true }); return this; }
  range(from: number, to: number): this { this.from = from; this.to = to; return this; }
  private read(): ReadResult {
    calls.push({ table: this.table, from: this.from });
    if (this.table === failTable && this.from >= failFrom) return { data: [], error: { message: 'Controlled read failure' } };
    const rows = (tables[this.table] ?? []).filter((row) => this.predicates.every((predicate) => predicate(row)));
    rows.sort((left, right) => {
      for (const { column, ascending } of this.orders) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    return { data: rows.slice(this.from, Math.min(this.to + 1, this.from + 1000)), error: null };
  }
  async maybeSingle(): Promise<{ data: Row | null; error: ReadResult['error'] }> { const result = this.read(); return { ...result, data: result.data[0] ?? null }; }
  then<TResult1 = ReadResult, TResult2 = never>(
    fulfilled?: ((value: ReadResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.read();
    const ready = this.table === 'time_entries' && legacyBarrier
      ? legacyBarrier.then(() => result) : Promise.resolve(result);
    return ready.then(fulfilled, rejected);
  }
}

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: (table: string) => new Query(table) }) }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: {}, getAuthenticatedUser: async () => authenticated ? { id: callerId } : null,
  getCachedMemberships: async () => [{ orgId: organizationId, role }], getCachedOrganizationSettings: async () => ({}), getCachedOrganizationCalendar: async () => ({}),
}));
mock.module('@/lib/time-corrections/actions', () => ({
  getApprovedTimeCorrectionApplications: async () => { startedProjections.add('approved'); if (correctionFailure) throw new Error('Controlled correction failure'); return []; },
  getProvisionalTimeCorrectionProjection: async () => { startedProjections.add('provisional'); if (provisionalFailure) throw new Error('Controlled provisional failure'); return { entries: [], sources: [] }; },
}));
const { getTimeEntries } = await import('@/lib/time-tracking/actions');
const { getVacationCalendarEntries } = await import('@/lib/vacation/actions');
const { getSicknessCalendarEntries } = await import('@/lib/sickness/actions');
const window = { from: '2026-06-15', to: '2026-06-15' };
const timeWindow = { organizationId, from: '2026-06-15T00:00:00.000Z', to: '2026-06-15T23:59:59.999Z' };
const identity = (index: number): string => String(index).padStart(5, '0');
function legacy(index: number, userId = callerId): Row {
  return { id: identity(index), organization_id: organizationId, user_id: userId, entry_type: 'clock_in', timestamp: timeWindow.from,
    is_manual: false, job_id: null, status: 'approved', reviewed_by: null, reviewed_at: null, created_at: timeWindow.from, updated_at: timeWindow.from };
}
// Independent projections must start while the legacy transport is held.
const barrier = Promise.withResolvers<void>();
legacyBarrier = barrier.promise;
const parallelRead = getTimeEntries(timeWindow);
try {
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(calls.some((call) => call.table === 'time_entries'));
  assert.ok(calls.some((call) => call.table === 'employee_records'));
  assert.deepEqual([...startedProjections].sort(), ['approved', 'provisional']);
} finally { barrier.resolve(); legacyBarrier = undefined; }
assert.ok((await parallelRead).success);

tables.time_entries = Array.from({ length: 1001 }, (_, index) => legacy(index));
tables.time_entries.push({ ...legacy(3000), organization_id: 'foreign' }, { ...legacy(3001), timestamp: '2026-01-01T00:00:00.000Z' });
let result = await getTimeEntries(timeWindow);
assert.ok(result.success); if (result.success) assert.equal(result.entries.length, 1001);
assert.ok(calls.some((call) => call.table === 'time_entries' && call.from === 1000));
role = 'employee';
tables.time_entries.unshift(...Array.from({ length: 10001 }, (_, index) => legacy(index + 2000, 'other')));
result = await getTimeEntries(timeWindow);
assert.ok(result.success); if (result.success) { assert.equal(result.entries.length, 1001); assert.ok(result.entries.every((entry) => entry.userId === callerId)); }
role = 'admin';
tables.time_entries = Array.from({ length: 10001 }, (_, index) => legacy(index));
assert.equal((await getTimeEntries(timeWindow)).success, false);
tables.time_entries = Array.from({ length: 1001 }, (_, index) => legacy(index));
failTable = 'time_entries'; failFrom = 1000;
assert.equal((await getTimeEntries(timeWindow)).success, false);
failTable = ''; correctionFailure = true;
assert.equal((await getTimeEntries(timeWindow)).success, false);
correctionFailure = false; provisionalFailure = true;
assert.equal((await getTimeEntries(timeWindow)).success, false);
provisionalFailure = false; tables.time_entries = [];

tables.employee_records = [{ id: 'employee', user_id: callerId, organization_id: organizationId }];
tables.time_segments = Array.from({ length: 1001 }, (_, index) => ({
  id: identity(index), session_id: `session-${index}`, organization_id: organizationId, employee_record_id: 'employee', kind: 'work', allocation_kind: 'unallocated',
  job_id: null, internal_type: null, travel_route: null, travel_role: null, standby_context: null,
  started_at: '2026-06-15T08:00:00.000Z', ended_at: '2026-06-15T09:00:00.000Z', created_at: timeWindow.from, updated_at: timeWindow.from,
}));
result = await getTimeEntries(timeWindow);
assert.ok(result.success); if (result.success) assert.equal(new Set(result.entries.map((entry) => entry.canonicalSegmentId)).size, 1001);
failTable = 'time_segments'; failFrom = 1000;
assert.equal((await getTimeEntries(timeWindow)).success, false);
failTable = '';
const segmentTemplate = tables.time_segments?.[0];
assert.ok(segmentTemplate, 'expected a seeded time segment');
tables.time_segments = Array.from({ length: 10001 }, (_, index) => ({ ...segmentTemplate, id: identity(index) }));
assert.equal((await getTimeEntries(timeWindow)).success, false);
tables.time_segments = [];

for (const [table, read] of [['vacation_requests', getVacationCalendarEntries], ['sickness_reports', getSicknessCalendarEntries]] as const) {
  tables.employee_records = Array.from({ length: 1001 }, (_, index) => ({ id: identity(index), user_id: `person-${index}`, organization_id: organizationId, first_name: null, last_name: null }));
  tables.profiles = Array.from({ length: 1001 }, (_, index) => ({ id: `person-${index}`, first_name: `Person ${index}`, last_name: 'Test' }));
  tables[table] = Array.from({ length: 1001 }, (_, index) => ({
    id: identity(index), organization_id: organizationId, employee_record_id: identity(index), start_date: window.from, end_date: window.to,
    day_portion: 'full', status: table === 'vacation_requests' ? 'approved' : 'reported',
  }));
  tables[table].push({ ...tables[table][0], id: 'foreign', organization_id: 'foreign' }, { ...tables[table][0], id: 'old', start_date: '2025-01-01', end_date: '2025-01-02' });
  const absence = await read(window);
  assert.ok(absence.success); if (absence.success) { assert.equal(absence.entries.length, 1001); assert.equal(absence.entries.at(-1)?.personName, 'Person 1000 Test'); }
  const lastEmployee = tables.employee_records?.[1000];
  assert.ok(lastEmployee, 'expected the seeded employee record');
  lastEmployee.user_id = callerId; role = 'employee';
  const own = await read(window);
  assert.ok(own.success); if (own.success) assert.deepEqual(own.entries.map((entry) => entry.id), [identity(1000)]);
  role = 'admin'; failTable = table; failFrom = 1000;
  assert.equal((await read(window)).success, false);
  failTable = '';
  const absenceTemplate = tables[table]?.[0];
  assert.ok(absenceTemplate, 'expected a seeded absence row');
  tables[table] = Array.from({ length: 10001 }, (_, index) => ({ ...absenceTemplate, id: identity(index) }));
  assert.equal((await read(window)).success, false);
}
authenticated = false;
const readCount = calls.length;
assert.equal((await getTimeEntries(timeWindow)).success, false);
assert.equal((await getVacationCalendarEntries(window)).success, false);
assert.equal((await getSicknessCalendarEntries(window)).success, false);
assert.equal(calls.length, readCount);
