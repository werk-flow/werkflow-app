// The real job-page assignment action over the in-memory database: adding a
// person who left, or one on approved vacation, to a job's upcoming visit is
// refused with the planning conflict until a manager confirms it with a
// reason, and the confirmed write records the visit's assessment with that
// reason in the same database call. The capacity facts (employment, access,
// vacation, overlapping visits) are the real planning reads; only the
// qualification evaluation and the holiday calendar stand in.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const jobId = '60000000-0000-4000-8000-000000000001';
const visitId = '61000000-0000-4000-8000-000000000001';
const erikUserId = '30000000-0000-4000-8000-000000000031';
const erikRecordId = '62000000-0000-4000-8000-000000000031';
const mehmetUserId = '30000000-0000-4000-8000-000000000032';
const mehmetRecordId = '62000000-0000-4000-8000-000000000032';
const callerRecordId = '62000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';
// A visit far ahead, so it has not started whatever day the suite runs.
const visitDate = '2099-11-04';

const record = (id: string, userId: string, exitDate: string | null) => ({
  id,
  organization_id: ORGANIZATION_A,
  user_id: userId,
  first_name: null,
  last_name: null,
  entry_date: '2020-01-01',
  exit_date: exitDate,
  personnel_access_lifecycles: [],
});

const world = installActionWorld({
  jobs: [
    {
      id: jobId,
      organization_id: ORGANIZATION_A,
      job_number: 'A-2099-001',
      title: 'Gastherme Inbetriebnahme',
      planned_date: visitDate,
      created_at: now,
      updated_at: now,
    },
  ],
  job_assignments: [
    {
      id: '63000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      user_id: CALLER_ID,
      assigned_by: CALLER_ID,
      assigned_at: now,
    },
  ],
  // The job's legacy visit, with its people as the embedded assignment rows.
  planning_occurrences: [
    {
      id: visitId,
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      legacy_source_job_id: jobId,
      status: 'scheduled',
      version: 3,
      time_kind: 'timed',
      start_at: `${visitDate}T07:00:00.000Z`,
      end_at: `${visitDate}T11:00:00.000Z`,
      start_date: null,
      end_date_exclusive: null,
      original_start_local: null,
      assignments: [{ employee_record_id: callerRecordId, team_source_id: null }],
    },
  ],
  employee_records: [
    record(callerRecordId, CALLER_ID, null),
    record(erikRecordId, erikUserId, '2099-10-29'),
    record(mehmetRecordId, mehmetUserId, null),
  ],
  // Everyone works eight hours on weekdays, so no missing-schedule warning joins the conflicts.
  work_schedules: [callerRecordId, erikRecordId, mehmetRecordId].map((employeeRecordId, index) => ({
    id: `65000000-0000-4000-8000-00000000000${index}`,
    organization_id: ORGANIZATION_A,
    employee_record_id: employeeRecordId,
    valid_from: '2020-01-01',
    monday_minutes: 480,
    tuesday_minutes: 480,
    wednesday_minutes: 480,
    thursday_minutes: 480,
    friday_minutes: 480,
    saturday_minutes: 0,
    sunday_minutes: 0,
    note: null,
    created_by: CALLER_ID,
    created_at: now,
    updated_at: now,
  })),
  vacation_requests: [
    {
      id: '64000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_A,
      employee_record_id: mehmetRecordId,
      status: 'approved',
      start_date: '2099-11-02',
      end_date: '2099-11-06',
      day_portion: 'full',
    },
  ],
  profiles: [
    { id: erikUserId, first_name: 'Erik', last_name: 'Lindner' },
    { id: mehmetUserId, first_name: 'Mehmet', last_name: 'Aydın' },
  ],
});

const cached = await import('@/lib/data/cached');
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationCalendar: async () => EMPTY_HOLIDAY_CALENDAR,
}));
mock.module('@/lib/qualifications/server', () => ({
  loadAssignmentEvaluation: async (input: { selectedUserIds: string[]; assessedForDate: string }) => ({
    success: true,
    evaluation: {
      jobId,
      assessedForDate: input.assessedForDate,
      selectedUserIds: input.selectedUserIds,
      selectedEmployeeRecordIds: [],
      requirementCoverage: [],
      apprenticeWarning: { status: 'not_configured' },
      requiresOverride: false,
      fingerprint: 'qualification-fingerprint',
    },
  }),
}));
mock.module('@/lib/planning/qualification-evaluations', () => ({
  loadPlanningQualificationEvaluations: async () => [],
}));

const { updateJobAssignments } = await import('@/lib/jobs/actions');
signInAs(world, 'admin');

// Erik left before the visit date: the save is refused with the conflict and writes nothing.
const refused = await updateJobAssignments(jobId, [CALLER_ID, erikUserId]);
assert.equal(refused.success, false);
assert.ok(!refused.success && 'conflicts' in refused, 'the refusal carries the planning conflicts');
assert.equal(refused.error, 'planning_warning');
assert.deepEqual(
  refused.conflicts.map((conflict) => [conflict.kind, conflict.employeeName, conflict.localDate]),
  [['outside_employment', 'Erik Lindner', visitDate]],
);
assert.equal(world.rpcCalls.length, 0, 'an unconfirmed conflict writes nothing');

// A reason for an assessment the manager did not see is refused as stale.
const stale = await updateJobAssignments(jobId, [CALLER_ID, erikUserId], null, null, {
  fingerprint: 'f'.repeat(64),
  reason: 'Abschlussarbeiten vor dem Austritt vereinbart',
});
assert.ok(!stale.success && stale.error === 'stale_assessment');
assert.equal(world.rpcCalls.length, 0);

// Mehmet's approved vacation covers the visit date: the calendar's check refuses him,
// and the vacation leaves him no time for the visit.
const vacation = await updateJobAssignments(jobId, [CALLER_ID, mehmetUserId]);
assert.ok(!vacation.success && 'conflicts' in vacation);
assert.deepEqual(
  vacation.conflicts.map((conflict) => [conflict.kind, conflict.employeeName]),
  [
    ['approved_absence', 'Mehmet Aydın'],
    ['over_capacity', 'Mehmet Aydın'],
  ],
);

// Confirmed with a reason for exactly that assessment, the team and the visit's assessment are one call.
const confirmed = await updateJobAssignments(jobId, [CALLER_ID, erikUserId], null, null, {
  fingerprint: refused.fingerprint,
  reason: 'Abschlussarbeiten vor dem Austritt vereinbart',
});
assert.equal(confirmed.success, true);
assert.equal(world.rpcCalls.length, 1);
const [write] = world.rpcCalls;
assert.equal(write?.name, 'replace_job_assignments_with_visit_assessment');
assert.equal(write?.args.p_organization_id, ORGANIZATION_A);
assert.deepEqual(write?.args.p_expected_user_ids, [CALLER_ID], 'the write refuses a team that changed since');
assert.equal(write?.args.p_visit_id, visitId);
assert.equal(write?.args.p_visit_version, 3);
assert.equal(write?.args.p_capacity_fingerprint, refused.fingerprint);
assert.equal(write?.args.p_planning_override_reason, 'Abschlussarbeiten vor dem Austritt vereinbart');

// Removing a person adds nobody to the visit: no capacity check, no visit assessment.
world.rpcCalls = [];
const removal = await updateJobAssignments(jobId, []);
assert.equal(removal.success, true);
assert.equal(world.rpcCalls[0]?.args.p_visit_id, null);
