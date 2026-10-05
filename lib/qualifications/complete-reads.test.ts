import { expect, test } from 'bun:test';
import { ID_BATCH_SIZE, ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';
import { loadAssignmentEvaluation, loadCertificationExpiryNotifications } from './server';

// A company with 600 employees: the certification notices refused more than
// 500 rows, and the assignment evaluation sent up to 200 ids in one query
// string and refused more than 500 capability or condition rows.
type Row = Record<string, unknown>;
type Admin = Parameters<typeof loadCertificationExpiryNotifications>[0]['admin'];

/** A PostgREST stand-in: 1,000 rows per response, every id list recorded. */
function createFakeAdmin(tables: Record<string, Row[]>) {
  const listSizes: number[] = [];
  const pageStarts: Record<string, number[]> = {};
  const admin = {
    from: (table: string) => {
      const predicates: Array<(row: Row) => boolean> = [];
      let rangeStart = 0;
      const read = () => {
        (pageStarts[table] ??= []).push(rangeStart);
        const rows = (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)));
        return { data: rows.slice(rangeStart, rangeStart + ROW_PAGE_SIZE), error: null };
      };
      const query = {
        select: () => query,
        order: () => query,
        not: () => query,
        is: () => query,
        lte: (column: string, value: string) => {
          predicates.push((row) => String(row[column]) <= value);
          return query;
        },
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
        maybeSingle: async () => ({ data: read().data[0] ?? null, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => void) => resolve(read()),
      };
      return query;
    },
  };
  return { admin: admin as unknown as Admin, listSizes, pageStarts };
}

const organization_id = 'org';
const employeeCount = 600;
const employee_records = Array.from({ length: employeeCount }, (_, index) => ({
  id: `record-${index}`,
  organization_id,
  user_id: `user-${index}`,
  first_name: 'Person',
  last_name: String(index),
}));
const profiles = employee_records.map((record, index) => ({
  id: record.user_id,
  first_name: 'Person',
  last_name: String(index),
}));
const capability = (index: number, employeeIndex: number, validFrom: string): Row => ({
  id: `capability-record-${index}`,
  organization_id,
  employee_record_id: `record-${employeeIndex}`,
  capability_id: 'certificate',
  capability_kind: 'certification',
  valid_from: validFrom,
  valid_until: '2026-10-15',
  issuer: null,
  renewal_due_date: null,
  confirmation_status: 'confirmed',
  evidence_state: 'not_required',
  operational_note: null,
  supersedes_id: null,
  superseded_at: null,
});

test('certification notices cover 1,800 certifications of 600 employees', async () => {
  const { admin, listSizes, pageStarts } = createFakeAdmin({
    employee_records,
    profiles,
    organization_capabilities: [
      { id: 'certificate', organization_id, name: 'Gasprüfung', default_expiry_warning_days: 30 },
    ],
    employee_capabilities: Array.from({ length: 1_800 }, (_, index) =>
      capability(index, index % employeeCount, '2024-01-01'),
    ),
  });
  const result = await loadCertificationExpiryNotifications({
    admin,
    orgId: organization_id,
    today: '2026-10-01',
  });
  expect(result.failed).toBe(false);
  expect(result.notices.length).toBe(1_800);
  expect(result.notices.at(-1)?.employeeName).toBe(`Person ${1_799 % employeeCount}`);
  expect(pageStarts.employee_capabilities).toEqual([0, ROW_PAGE_SIZE]);
  expect(Math.max(...listSizes)).toBeLessThanOrEqual(ID_BATCH_SIZE);
});

test('an assignment evaluation of 200 people batches its ids and keeps the newest condition', async () => {
  const selectedEmployeeRecordIds = employee_records.slice(0, 200).map((record) => record.id);
  const { admin, listSizes } = createFakeAdmin({
    employee_records,
    profiles,
    organization_qualification_settings: [{ organization_id, apprentice_warning_enabled: true }],
    organization_capabilities: [
      {
        id: 'certificate',
        organization_id,
        kind: 'certification',
        name: 'Gasprüfung',
        description: null,
        default_expiry_warning_days: 30,
        retired_at: null,
      },
    ],
    // Six records per person: more than the former 500-row bound, and an unrelated capability to filter out.
    employee_capabilities: selectedEmployeeRecordIds.flatMap((_, employeeIndex) =>
      Array.from({ length: 6 }, (_, index) => ({
        ...capability(employeeIndex * 6 + index, employeeIndex, `202${index}-01-01`),
        capability_id: index === 5 ? 'unrelated' : 'certificate',
      })),
    ),
    // Stored oldest first, so the newest condition only wins after the in-memory sort.
    employment_conditions: selectedEmployeeRecordIds.flatMap((employee_record_id) => [
      { organization_id, employee_record_id, employment_type: 'vollzeit', valid_from: '2020-01-01' },
      { organization_id, employee_record_id, employment_type: 'ausbildung', valid_from: '2024-01-01' },
      { organization_id, employee_record_id, employment_type: 'teilzeit', valid_from: '2022-01-01' },
    ]),
  });
  const result = await loadAssignmentEvaluation({
    admin,
    orgId: organization_id,
    selectedEmployeeRecordIds,
    assessedForDate: '2026-10-01',
    requirementRows: [{ id: 'requirement', capability_id: 'certificate', require_confirmation: false }],
  });
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(Math.max(...listSizes)).toBeLessThanOrEqual(ID_BATCH_SIZE);
  expect(result.evaluation.selectedEmployeeRecordIds.length).toBe(200);
  expect(result.evaluation.requirementCoverage.map((coverage) => coverage.status)).toEqual(['covered']);
  // Every person's newest condition is the apprenticeship; the first stored row is not.
  expect(result.evaluation.apprenticeWarning.status).toBe('apprentices_only');
});
