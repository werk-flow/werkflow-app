// The board GET (P1-24a): the actual route, reader and auth resolver run below
// over isolated framework and provider seams. Proves the denial of outsiders,
// the organization check, the bounded window, and that an employee receives
// exactly their own row, targets and dispatch states.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { CalendarBoardInput } from '@/lib/calendar/board-actions';

const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'admin' | 'buero' | 'employee' }> = [{ orgId: organizationId, role: 'admin' }];
let activeCookie = organizationId;
let callerId = 'manager';
let targetReads = 0;
let dispatchReads = 0;
const input: CalendarBoardInput = { organizationId, fromDate: '2026-06-15', toDate: '2026-06-16' };

const employeeRecords = [
  { id: 'record-manager', user_id: 'manager', first_name: 'Lena', last_name: 'Hartmann', entry_date: null, exit_date: null },
  { id: 'record-worker', user_id: 'worker', first_name: 'Sven', last_name: 'Neumann', entry_date: '2012-08-01', exit_date: null },
  { id: 'record-no-login', user_id: null, first_name: 'Ohne', last_name: 'Login', entry_date: null, exit_date: null },
];
const tables: Record<string, unknown[]> = {
  employee_records: employeeRecords,
  profiles: [{ id: 'manager', first_name: 'Lena', last_name: 'Hartmann' }, { id: 'worker', first_name: 'Sven', last_name: 'Neumann' }],
  organization_members: [{ user_id: 'manager', role: 'buero' }, { user_id: 'worker', role: 'employee' }],
  team_memberships: [{ employee_record_id: 'record-worker', team_id: 'team-heizung' }],
  planning_occurrences: [{ id: 'occurrence-one', job_id: 'job-one', own: [{ employee_record_id: 'record-worker' }] }],
  job_material_lines: [{ job_id: 'job-one' }],
  teams: [{ id: 'team-heizung', name: 'Heizung' }],
};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: activeCookie }) }) }));
mock.module('next/cache', () => ({ unstable_cache: (read: unknown) => read }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: authenticated ? { id: callerId } : null }, error: null }),
} }) }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  from: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query: Record<string, unknown> = {};
    const chain = () => query;
    for (const method of ['select', 'or', 'order', 'lte', 'gte', 'gt', 'limit', 'not', 'range', 'is']) query[method] = chain;
    query.in = (column: string, values: unknown[]) => { filters.push([column, values]); return query; };
    query.eq = (column: string, value: unknown) => { filters.push([column, value]); return query; };
    query.then = (resolve: (result: { error: null; data: unknown[] }) => void) => {
      let rows = tables[table] ?? [];
      // The membership resolver filters by one user id; the board reader by a user id list.
      if (table === 'organization_members' && !filters.some(([column, value]) => column === 'user_id' && Array.isArray(value))) {
        rows = memberships.map((member) => ({
          organization_id: member.orgId, user_id: callerId, role: member.role, joined_at: '2026-01-01',
          organizations: { id: member.orgId, name: 'Fixture company', unique_code: 'fixture', employee_records: [] },
        }));
      }
      for (const [column, value] of filters) {
        if (column === 'user_id' && !Array.isArray(value)) rows = rows.filter((row) => (row as { user_id: string | null }).user_id === value);
        if (column === 'own.employee_record_id') rows = rows.filter((row) => (row as { own: Array<{ employee_record_id: string }> }).own.some((assignment) => assignment.employee_record_id === value));
      }
      resolve({ error: null, data: rows });
    };
    return query;
  },
}) }));
mock.module('@/lib/planning/server', () => ({
  loadDailyTargetsByRecord: async (request: { employeeRecordIds: string[]; dates: string[] }) => {
    targetReads++;
    const targetByEmployeeDate = new Map<string, unknown>();
    for (const record of request.employeeRecordIds) {
      for (const date of request.dates) {
        targetByEmployeeDate.set(`${record}:${date}`, {
          date, weekday: 0, targetMinutes: record === 'record-no-login' ? 0 : 480, baseTargetMinutes: 480, source: 'schedule',
          isHoliday: false, holidayName: null, isClosureDay: false, closureLabel: null,
          absence: record === 'record-no-login' ? { type: 'vacation', portion: 'full' } : null,
        });
      }
    }
    return { targetByEmployeeDate, pendingVacation: [{ employee_record_id: 'record-worker', start_date: '2026-06-16', end_date: '2026-06-16', day_portion: 'full' }] };
  },
}));
mock.module('@/lib/dispatch/server', () => ({
  loadOccurrenceDispatchStates: async (_admin: unknown, _orgId: string, occurrenceIds: string[]) => {
    dispatchReads++;
    return occurrenceIds.flatMap((occurrenceId) => [
      { occurrenceId, employeeRecordId: 'record-worker', state: 'bestaetigt' },
      { occurrenceId, employeeRecordId: 'record-manager', state: 'ausstehend' },
    ]);
  },
}));

const { GET } = await import('@/app/api/calendar-board/route');
const request = (values: CalendarBoardInput = input): Request => new Request(`http://localhost/api/calendar-board?${new URLSearchParams(values)}`);
async function check(response: Response, status: number): Promise<Record<string, unknown>> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return response.json() as Promise<Record<string, unknown>>;
}

authenticated = false;
assert.deepEqual(await check(await GET(request()), 401), { success: false, error: 'not_authenticated' });
authenticated = true;
memberships = [];
assert.deepEqual(await check(await GET(request()), 403), { success: false, error: 'no_active_org' });
memberships = [{ orgId: organizationId, role: 'admin' }];
activeCookie = foreignOrg;
assert.deepEqual(await check(await GET(request({ ...input, organizationId: foreignOrg })), 403), { success: false, error: 'organization_changed' });
activeCookie = organizationId;
for (const invalid of [{ ...input, fromDate: '2026-02-30' }, { ...input, toDate: '2024-01-01' }, { ...input, toDate: '2028-01-01' }]) {
  assert.deepEqual(await check(await GET(request(invalid)), 400), { success: false, error: 'invalid_input' });
}
assert.deepEqual(await check(await GET(new Request('http://localhost/api/calendar-board')), 400), { success: false, error: 'invalid_input' });
assert.equal(targetReads, 0, 'no target read before authorization and validation pass');

// A manager sees every record, the team of the window start, login state, pending vacation and every dispatch state.
const managerBoard = await check(await GET(request()), 200);
assert.equal(managerBoard.success, true);
const rows = managerBoard.rows as Array<{ employeeRecordId: string; displayName: string; hasLogin: boolean; teamName: string | null; role: string | null }>;
assert.deepEqual(rows.map((row) => row.employeeRecordId), ['record-manager', 'record-worker', 'record-no-login']);
assert.deepEqual(rows.map((row) => [row.hasLogin, row.teamName, row.role]), [[true, null, 'buero'], [true, 'Heizung', 'employee'], [false, null, null]]);
const days = managerBoard.days as Array<{ employeeRecordId: string; date: string; targetMinutes: number; pendingVacation: boolean; absence: unknown }>;
assert.equal(days.length, 6);
assert.deepEqual(days.find((day) => day.employeeRecordId === 'record-worker' && day.date === '2026-06-16')?.pendingVacation, true);
assert.deepEqual(days.find((day) => day.employeeRecordId === 'record-no-login')?.absence, { type: 'vacation', portion: 'full' });
assert.equal((managerBoard.dispatch as unknown[]).length, 2);
assert.deepEqual(managerBoard.materialDemandJobIds, ['job-one']);

// An employee receives exactly their own row, their own targets and their own dispatch states.
memberships = [{ orgId: organizationId, role: 'employee' }];
callerId = 'worker';
const employeeBoard = await check(await GET(request()), 200);
assert.deepEqual((employeeBoard.rows as Array<{ employeeRecordId: string }>).map((row) => row.employeeRecordId), ['record-worker']);
assert.deepEqual([...new Set((employeeBoard.days as Array<{ employeeRecordId: string }>).map((day) => day.employeeRecordId))], ['record-worker']);
assert.deepEqual(employeeBoard.dispatch, [{ occurrenceId: 'occurrence-one', employeeRecordId: 'record-worker', state: 'bestaetigt' }]);
assert.equal(dispatchReads, 2);

// A member without an employee record sees nothing, not a failure.
callerId = 'stranger';
const strangerBoard = await check(await GET(request()), 200);
assert.deepEqual(strangerBoard, { success: true, rows: [], days: [], dispatch: [], materialDemandJobIds: [] });
console.info('calendar-board-http fixture passed');
