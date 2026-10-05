import { expect, mock, test } from 'bun:test';
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
mock.module('@/lib/vacation/server', () => ({
  loadApprovedVacationSpansByRecord: async () => (vacationSpansFail ? null : new Map()),
}));
mock.module('@/lib/sickness/server', () => ({
  loadActiveSicknessSpansByRecord: async () => (sicknessSpansFail ? null : new Map()),
}));

const { loadDailyTargetsByRecord } = await import('./server');

test('daily targets read organization-sized id lists in gateway-safe batches', async () => {
  const batchSizes: Record<string, number[]> = {};
  const admin = {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        lte: () => query,
        gte: () => query,
        in: (_column: string, ids: readonly string[]) => {
          (batchSizes[table] ??= []).push(ids.length);
          return query;
        },
        then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      };
      return query;
    },
  };
  const employeeRecordIds = Array.from({ length: 205 }, (_, index) => `record-${index}`);
  const targets = await loadDailyTargetsByRecord({
    admin: admin as unknown as Parameters<typeof loadDailyTargetsByRecord>[0]['admin'],
    orgId: 'org',
    employeeRecordIds,
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
  const admin = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        lte: () => query,
        gte: () => query,
        in: () => query,
        then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      };
      return query;
    },
  };
  const input = {
    admin: admin as unknown as Parameters<typeof loadDailyTargetsByRecord>[0]['admin'],
    orgId: 'org',
    employeeRecordIds: ['record-0'],
    dates: ['2026-10-01'],
  };
  try {
    vacationSpansFail = true;
    expect(await loadDailyTargetsByRecord(input)).toBeNull();
    vacationSpansFail = false;
    sicknessSpansFail = true;
    expect(await loadDailyTargetsByRecord(input)).toBeNull();
  } finally {
    vacationSpansFail = false;
    sicknessSpansFail = false;
  }
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
  const admin = {
    from: () => {
      let wanted = new Set<string>();
      let rangeStart = 0;
      const query = {
        select: () => query,
        eq: () => query,
        lte: () => query,
        or: () => query,
        order: () => query,
        in: (_column: string, ids: readonly string[]) => {
          batchSizes.push(ids.length);
          wanted = new Set(ids);
          return query;
        },
        range: (from: number) => {
          rangeStart = from;
          return query;
        },
        then: (resolve: (result: { data: unknown[]; error: null }) => void) => {
          pageStarts.push(rangeStart);
          resolve({
            data: memberships
              .filter((row) => wanted.has(row.team_id))
              .slice(rangeStart, rangeStart + ROW_PAGE_SIZE),
            error: null,
          });
        },
      };
      return query;
    },
  };
  const expanded = await expandPlanningTeamsForDates({
    admin: admin as unknown as Parameters<typeof expandPlanningTeamsForDates>[0]['admin'],
    orgId: 'org',
    teamIds,
    localDates: ['2026-10-01', '2026-10-02'],
  });
  expect(expanded?.get('2026-10-01')?.length).toBe(1_200);
  expect(expanded?.get('2026-10-02')?.length).toBe(1_199);
  expect(batchSizes.every((size) => size <= ID_BATCH_SIZE)).toBe(true);
  expect(pageStarts).toContain(ROW_PAGE_SIZE);
});
