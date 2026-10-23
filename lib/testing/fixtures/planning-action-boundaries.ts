// Actual planning actions over the in-memory database: an employee creates,
// extends, moves, reschedules and cancels no planning entry and is refused
// before the database, a manager of organization A finds no series or
// occurrence of organization B, and the calendar never lists an occurrence
// of organization B. A refused call writes nothing.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const foreignSeriesId = '89000000-0000-4000-8000-000000000001';
const foreignOccurrenceId = '89000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  employee_records: [
    { id: '89000000-0000-4000-8000-000000000003', organization_id: ORGANIZATION_A, user_id: CALLER_ID },
  ],
  planning_series: [
    { id: foreignSeriesId, organization_id: ORGANIZATION_B, generated_through_local: '2027-01-01T08:00' },
  ],
  planning_occurrences: [
    {
      id: foreignOccurrenceId,
      organization_id: ORGANIZATION_B,
      series_id: foreignSeriesId,
      series_lineage_id: foreignSeriesId,
      original_start_local: '2026-11-03T08:00',
      time_kind: 'timed',
      start_at: '2026-11-03T07:00:00.000Z',
      end_at: '2026-11-03T09:00:00.000Z',
      start_date: null,
      end_date_exclusive: null,
      status: 'planned',
      version: 1,
    },
  ],
});
const {
  createPlanningEntry,
  extendPlanningSeriesHorizon,
  getPlanningEntries,
  reschedulePlanningSeries,
  setPlanningOccurrenceStatus,
  updatePlanningCalendarEntry,
} = await import('@/lib/planning/actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const move = { plannedDate: '2026-11-04', plannedTime: '09:00' };
const entry = {
  entryKind: 'internal',
  internalType: 'meeting',
  jobId: null,
  title: 'Teambesprechung',
  description: null,
  location: null,
  timeKind: 'timed',
  startsAtLocal: '2026-11-03T08:00',
  durationMinutes: 60,
  durationDays: null,
  assignmentDrafts: [],
  overrideReason: null,
  assessmentFingerprint: null,
  idempotencyKey: '89000000-0000-4000-8000-000000000004',
  recurrence: null,
};

// A caller without an organization reads no calendar.
signInAs(world, null);
assert.deepEqual(await getPlanningEntries('2026-11-01', '2026-11-30'), {
  success: false,
  error: 'no_active_org',
});

// An employee creates, extends, moves, reschedules and cancels nothing, before any database access.
signInAs(world, 'employee');
assert.deepEqual(await createPlanningEntry(entry), notAuthorized);
assert.deepEqual(await extendPlanningSeriesHorizon(foreignSeriesId), notAuthorized);
assert.deepEqual(await updatePlanningCalendarEntry(foreignOccurrenceId, move), notAuthorized);
assert.deepEqual(await reschedulePlanningSeries(foreignOccurrenceId, 'future', move), notAuthorized);
assert.deepEqual(
  await setPlanningOccurrenceStatus(foreignOccurrenceId, 'cancelled', 'Termin entfällt'),
  notAuthorized,
);
assert.equal(world.adminClientRequests, 0);

// A Büro manager of organization A finds no series or occurrence of organization B.
signInAs(world, 'buero');
assert.deepEqual(await extendPlanningSeriesHorizon(foreignSeriesId), {
  success: false,
  error: 'series_not_found',
});
assert.deepEqual(await updatePlanningCalendarEntry(foreignOccurrenceId, move), {
  success: false,
  error: 'not_found',
});
assert.deepEqual(await reschedulePlanningSeries(foreignOccurrenceId, 'series', move), {
  success: false,
  error: 'series_not_found',
});
assert.deepEqual(await setPlanningOccurrenceStatus(foreignOccurrenceId, 'skipped', 'Termin entfällt'), {
  success: false,
  error: 'not_found',
});
assert.equal(world.rpcCalls.length, 0);

// The calendar of organization A never lists an occurrence of organization B.
const calendar = await getPlanningEntries('2026-11-01', '2026-11-30');
assert.ok(calendar.success);
assert.deepEqual(calendar.entries, []);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
