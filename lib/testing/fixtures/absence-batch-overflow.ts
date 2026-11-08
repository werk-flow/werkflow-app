// Two people's absences share one batched read, whose filter spans both
// windows, so one person's own visits inside the other's window fill it. Past
// the row bound the batch splits until each part fits, and each absence still
// gets exactly its own visits; a single absence past the bound fails.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld } from './action-boundary-world';

const queryBatches = await import('@/lib/supabase/query-batches');
// Three rows stand for the real bound, so four visits overflow a read.
mock.module('@/lib/supabase/query-batches', () => ({ ...queryBatches, LIST_ROW_CAP: 3 }));

const annaRecordId = '87000000-0000-4000-8000-000000000001';
const benRecordId = '87000000-0000-4000-8000-000000000002';
const annaMonday = '87000000-0000-4000-8000-000000000011';
const benWednesday = '87000000-0000-4000-8000-000000000012';

const visit = (id: string, recordId: string, day: string, hour: number) => ({
  id,
  organization_id: ORGANIZATION_A,
  status: 'scheduled',
  entry_kind: 'job_visit',
  internal_type: null,
  time_kind: 'timed',
  title: 'Einsatz',
  start_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  end_at: `${day}T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  start_date: null,
  end_date_exclusive: null,
  absent: [{ id: id.replace(/^87/, '88'), employee_record_id: recordId }],
  job: null,
});

installActionWorld({
  planning_occurrences: [
    visit(annaMonday, annaRecordId, '2026-11-16', 7),
    visit(benWednesday, benRecordId, '2026-11-18', 7),
    // Anna works on Ben's vacation day: the shared read sees these, neither absence keeps them.
    ...[9, 11, 13].map((hour, index) =>
      visit(`87000000-0000-4000-8000-00000000002${index}`, annaRecordId, '2026-11-18', hour),
    ),
  ],
  planning_dispatches: [],
});

const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
const { loadAbsencesAffectedVisits } = await import('@/lib/calendar/absence-visits');
const admin = createSupabaseAdminClient();

const split = await loadAbsencesAffectedVisits({
  admin,
  orgId: ORGANIZATION_A,
  absences: [
    { employeeRecordId: annaRecordId, from: '2026-11-16', to: '2026-11-16' },
    { employeeRecordId: benRecordId, from: '2026-11-18', to: '2026-11-18' },
  ],
});
assert.deepEqual(
  split?.map((affected) => affected.map(({ visit: { occurrenceId } }) => occurrenceId)),
  [[annaMonday], [benWednesday]],
  'an overflowing batch splits, and each absence keeps only its own visits',
);

const single = await loadAbsencesAffectedVisits({
  admin,
  orgId: ORGANIZATION_A,
  absences: [{ employeeRecordId: annaRecordId, from: '2026-11-16', to: '2026-11-18' }],
});
assert.equal(single, null, 'a single absence past the row bound fails, never a cut list');
