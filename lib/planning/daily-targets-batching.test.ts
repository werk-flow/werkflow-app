import { expect, mock, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';

// The board passes every employee record of the organization to this loader.
// One `in()` per table put all ids into one query string and the gateway
// answered 414 at 205 records (2026-09-30); each read now goes in id batches.
mock.module('server-only', () => ({}));
mock.module('@/lib/data/cached', () => ({
  getCachedOrganizationCalendar: async () => ({
    holidayRegion: null,
    holidayRegionHistory: [],
    closureDays: [],
  }),
}));
// A span reader answers null for a failed read; the switches below simulate one.
let vacationSpansFail = false;
let sicknessSpansFail = false;
let schoolSpansFail = false;
let schoolReads = 0;
mock.module('@/lib/vacation/server', () => ({
  loadApprovedVacationSpansByRecord: async () => (vacationSpansFail ? null : new Map()),
}));
mock.module('@/lib/sickness/server', () => ({
  loadActiveSicknessSpansByRecord: async () => (sicknessSpansFail ? null : new Map()),
}));
mock.module('@/lib/personnel/school-day-server', () => ({
  loadSchoolDaySpansByRecord: async () => {
    schoolReads += 1;
    return schoolSpansFail ? null : new Map();
  },
}));

const { loadDailyTargetsByRecord } = await import('./server');

/** A real admin client over a PostgREST stand-in: each read answers the rows `answer` returns for its URL. */
function adminAnswering(answer: (url: URL) => unknown[]): AdminClient {
  return createClient<Database>('http://127.0.0.1:54321', 'isolated-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async (input: Parameters<typeof fetch>[0]) =>
          Response.json(
            answer(
              new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url),
            ),
          ),
        { preconnect: fetch.preconnect },
      ),
    },
  });
}

/** An admin client whose every read answers no rows. */
function rowlessAdmin(): AdminClient {
  return adminAnswering(() => []);
}

/** The id list of each `in` filter of one request. */
function inFilterIds(url: URL): string[][] {
  return [...url.searchParams.values()]
    .filter((value) => value.startsWith('in.('))
    .map((value) => value.slice('in.('.length, -1).split(',').filter(Boolean));
}

test('daily targets read organization-sized id lists in gateway-safe batches', async () => {
  const batchSizes: Record<string, number[]> = {};
  const admin = adminAnswering((url) => {
    const table = url.pathname.split('/').at(-1) ?? '';
    for (const ids of inFilterIds(url)) (batchSizes[table] ??= []).push(ids.length);
    return [];
  });
  const employees = Array.from({ length: 205 }, (_, index) => ({
    id: `record-${index}`,
    entry_date: null,
    exit_date: null,
  }));
  const targets = await loadDailyTargetsByRecord({
    admin,
    orgId: 'org',
    employees,
    dates: ['2026-10-01', '2026-10-02'],
  });
  expect(targets).not.toBeNull();
  expect(targets?.targetByEmployeeDate.size).toBe(205 * 2);
  for (const table of ['work_schedules', 'employment_conditions', 'vacation_requests']) {
    const sizes = batchSizes[table];
    expect(sizes, table).toBeDefined();
    expect(
      sizes?.reduce((total, size) => total + size, 0),
      table,
    ).toBe(205);
    expect(Math.max(...(sizes ?? [0])), table).toBeLessThanOrEqual(ID_BATCH_SIZE);
  }
});

test('a failed absence span read fails the daily targets instead of reading as no absence', async () => {
  const input = {
    admin: rowlessAdmin(),
    orgId: 'org',
    employees: [{ id: 'record-0', entry_date: null, exit_date: null }],
    dates: ['2026-10-01'],
  };
  try {
    vacationSpansFail = true;
    expect(await loadDailyTargetsByRecord(input)).toBeNull();
    vacationSpansFail = false;
    sicknessSpansFail = true;
    expect(await loadDailyTargetsByRecord(input)).toBeNull();
    sicknessSpansFail = false;
    schoolSpansFail = true;
    // An apprentice in the window reads the school days, and their failure fails the targets.
    const apprentice = { ...input, admin: adminAnswering(apprenticeConditionRows) };
    expect(await loadDailyTargetsByRecord(apprentice)).toBeNull();
  } finally {
    vacationSpansFail = false;
    sicknessSpansFail = false;
    schoolSpansFail = false;
  }
});

/** The employment condition read answers an Ausbildung version; every other read answers none. */
function apprenticeConditionRows(url: URL): unknown[] {
  return url.pathname.endsWith('/employment_conditions')
    ? [
        {
          id: 'condition-0',
          organization_id: 'org',
          employee_record_id: 'record-0',
          valid_from: '2026-01-01',
          employment_type: 'ausbildung',
          weekly_hours: 40,
          vacation_days_per_year: 30,
          note: null,
          created_by: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]
    : [];
}

// werk-flow/werkflow-planning#165: school days exist only for apprentices,
// so a board or planning check without one pays no school-day request.
test('the daily targets read school days only when the window holds an apprentice', async () => {
  const input = {
    orgId: 'org',
    employees: [{ id: 'record-0', entry_date: null, exit_date: null }],
    dates: ['2026-10-01'],
  };
  schoolReads = 0;
  expect(await loadDailyTargetsByRecord({ ...input, admin: rowlessAdmin() })).not.toBeNull();
  expect(schoolReads).toBe(0);
  expect(
    await loadDailyTargetsByRecord({ ...input, admin: adminAnswering(apprenticeConditionRows) }),
  ).not.toBeNull();
  expect(schoolReads).toBe(1);
});

// werk-flow/werkflow-planning#79: the Plantafel showed a target on the day
// after the exit date.
test("daily targets end at each record's exit date", async () => {
  // 2026-10-29 is a Thursday, 2026-10-30 a Friday.
  const targets = await loadDailyTargetsByRecord({
    admin: rowlessAdmin(),
    orgId: 'org',
    employees: [{ id: 'record-0', entry_date: null, exit_date: '2026-10-29' }],
    dates: ['2026-10-29', '2026-10-30'],
  });
  expect(targets?.targetByEmployeeDate.get('record-0:2026-10-29')?.targetMinutes).toBeGreaterThan(0);
  expect(targets?.targetByEmployeeDate.get('record-0:2026-10-30')?.targetMinutes).toBe(0);
});

// A team may hold every employee: the expansion refused more than 5,000
// membership rows and sent every team id in one query string.
test('team expansion pages one large team and batches many team ids', async () => {
  const { expandPlanningTeamsForDates } = await import('./server');
  const { ROW_PAGE_SIZE } = await import('@/lib/supabase/query-batches');
  const teamIds = Array.from({ length: 120 }, (_, index) => `team-${index}`);
  const memberships = Array.from({ length: 1_200 }, (_, index) => ({
    team_id: 'team-0',
    employee_record_id: `record-${index}`,
    valid_from: '2026-01-01',
    valid_until: index === 0 ? '2026-10-01' : null,
  }));
  const batchSizes: number[] = [];
  const pageStarts: number[] = [];
  const admin = adminAnswering((url) => {
    let wanted = new Set<string>();
    for (const ids of inFilterIds(url)) {
      batchSizes.push(ids.length);
      wanted = new Set(ids);
    }
    const rangeStart = Number(url.searchParams.get('offset') ?? 0);
    pageStarts.push(rangeStart);
    return memberships.filter((row) => wanted.has(row.team_id)).slice(rangeStart, rangeStart + ROW_PAGE_SIZE);
  });
  const expanded = await expandPlanningTeamsForDates({
    admin,
    orgId: 'org',
    teamIds,
    localDates: ['2026-10-01', '2026-10-02'],
  });
  expect(expanded?.get('2026-10-01')?.length).toBe(1_200);
  expect(expanded?.get('2026-10-02')?.length).toBe(1_199);
  expect(batchSizes.every((size) => size <= ID_BATCH_SIZE)).toBe(true);
  expect(pageStarts).toContain(ROW_PAGE_SIZE);
});
