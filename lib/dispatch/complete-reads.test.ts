import { expect, mock, test } from 'bun:test';
import { ID_BATCH_SIZE, ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';

// The board asks for the dispatch states of every occurrence in its window.
// The former reads put all revision ids into one query string and refused
// more than 5,000 recipient or acknowledgement rows; a failed read was silent.
mock.module('server-only', () => ({}));

const { loadOccurrenceDispatchStates } = await import('./server');

type Row = Record<string, unknown>;
type Admin = Parameters<typeof loadOccurrenceDispatchStates>[0];

/** A PostgREST stand-in: 1,000 rows per response, every id list recorded. */
function createFakeAdmin(tables: Record<string, Row[]>, failingTable?: string) {
  const listSizes: number[] = [];
  const pageStarts: Record<string, number[]> = {};
  const admin = {
    from: (table: string) => {
      const predicates: Array<(row: Row) => boolean> = [];
      let rangeStart = 0;
      const query = {
        select: () => query,
        order: () => query,
        eq: (column: string, value: unknown) => {
          predicates.push((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: readonly string[]) => {
          listSizes.push(values.length);
          const wanted = new Set<unknown>(values);
          predicates.push((row) => wanted.has(row[column]));
          return query;
        },
        range: (from: number) => {
          rangeStart = from;
          return query;
        },
        then: (
          resolve: (result: { data: Row[]; error: { message: string; code: string } | null }) => void,
        ) => {
          (pageStarts[table] ??= []).push(rangeStart);
          if (table === failingTable)
            return resolve({ data: [], error: { message: 'Controlled read failure', code: 'XX000' } });
          const rows = (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)));
          resolve({ data: rows.slice(rangeStart, rangeStart + ROW_PAGE_SIZE), error: null });
        },
      };
      return query;
    },
  };
  return { admin: admin as unknown as Admin, listSizes, pageStarts };
}

const organization_id = 'org';
const occurrenceIds = Array.from({ length: 2_500 }, (_, index) => `occurrence-${index}`);
const employeeCount = 300;

function seedTables(): Record<string, Row[]> {
  return {
    planning_dispatches: occurrenceIds.map((occurrence_id, index) => ({
      id: `dispatch-${index}`,
      organization_id,
      occurrence_id,
      job_id: null,
      status: 'active',
      current_revision_id: `revision-${index}`,
    })),
    planning_dispatch_revisions: occurrenceIds.map((occurrence_id, index) => ({
      id: `revision-${index}`,
      organization_id,
      dispatch_id: `dispatch-${index}`,
      revision_number: 1,
      change_kind: 'issued',
      occurrence_id,
      job_id: null,
      dispatch_note: null,
      created_at: '2026-10-01T06:00:00Z',
    })),
    planning_dispatch_recipients: occurrenceIds.map((_, index) => ({
      organization_id,
      revision_id: `revision-${index}`,
      employee_record_id: `record-${index % employeeCount}`,
    })),
    // One revision with more acknowledgement rows than a response holds; the newest row is on the second page.
    planning_dispatch_acknowledgements: Array.from({ length: ROW_PAGE_SIZE + 100 }, (_, index) => ({
      id: `acknowledgement-${String(index).padStart(5, '0')}`,
      organization_id,
      revision_id: 'revision-0',
      employee_record_id: 'record-0',
      state: index === ROW_PAGE_SIZE + 99 ? 'acknowledged' : 'challenged',
      reason: 'Rückfrage',
      challenge_resolved_at: null,
      created_at: new Date(Date.UTC(2026, 9, 1, 6, 0, index)).toISOString(),
    })),
    employee_records: Array.from({ length: employeeCount }, (_, index) => ({
      id: `record-${index}`,
      organization_id,
      user_id: `user-${index}`,
      first_name: 'Person',
      last_name: String(index),
    })),
    profiles: Array.from({ length: employeeCount }, (_, index) => ({
      id: `user-${index}`,
      first_name: 'Person',
      last_name: String(index),
    })),
    organization_members: Array.from({ length: employeeCount }, (_, index) => ({
      organization_id,
      user_id: `user-${index}`,
    })),
  };
}

test('dispatch states of 2,500 occurrences read in id batches and complete pages', async () => {
  const { admin, listSizes, pageStarts } = createFakeAdmin(seedTables());
  const states = await loadOccurrenceDispatchStates(admin, organization_id, occurrenceIds);
  expect(states).not.toBeNull();
  expect(states?.length).toBe(occurrenceIds.length);
  expect(new Set(states?.map((entry) => entry.occurrenceId)).size).toBe(occurrenceIds.length);
  expect(Math.max(...listSizes)).toBeLessThanOrEqual(ID_BATCH_SIZE);
  expect(pageStarts.planning_dispatch_acknowledgements).toContain(ROW_PAGE_SIZE);
  // The latest acknowledgement lies beyond the first 1,000 rows of its revision.
  expect(states?.find((entry) => entry.occurrenceId === 'occurrence-0')?.state).toBe('bestaetigt');
  expect(states?.find((entry) => entry.occurrenceId === 'occurrence-1')?.state).toBe('ausstehend');
});

test('a failed dispatch read is null and logged, never an empty state list', async () => {
  const logged = mock(() => {});
  const originalError = console.error;
  console.error = logged;
  try {
    for (const failingTable of ['planning_dispatches', 'planning_dispatch_recipients', 'employee_records']) {
      const { admin } = createFakeAdmin(seedTables(), failingTable);
      expect(
        await loadOccurrenceDispatchStates(admin, organization_id, occurrenceIds),
        failingTable,
      ).toBeNull();
    }
  } finally {
    console.error = originalError;
  }
  expect(logged.mock.calls.length).toBe(3);
});
