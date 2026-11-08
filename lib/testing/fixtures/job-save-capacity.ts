// The real job create and edit actions over the in-memory database: a job
// saved with a date and people plans its legacy visit, so a person on
// approved vacation, or one who left, is refused with the planning conflict
// until a manager confirms it with a reason. The confirmed save sends the
// assessed visit (its people and time) with the reason to the one database
// call that writes the job. The capacity facts (employment, vacation,
// schedules) are the real planning reads; only the qualification evaluation
// and the holiday calendar stand in.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';
import { isJsonRecord } from '@/lib/supabase/json';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const jobId = '60000000-0000-4000-8000-000000000101';
const foreignJobId = '60000000-0000-4000-8000-000000000102';
const visitId = '61000000-0000-4000-8000-000000000101';
const erikUserId = '30000000-0000-4000-8000-000000000031';
const erikRecordId = '62000000-0000-4000-8000-000000000031';
const mehmetUserId = '30000000-0000-4000-8000-000000000032';
const mehmetRecordId = '62000000-0000-4000-8000-000000000032';
const callerRecordId = '62000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';
// Dates far ahead, so no visit has started whatever day the suite runs.
const vacationDate = '2099-11-04';
const freeDate = '2099-11-10';
const reason = 'Mit Mehmet abgestimmt, er kommt vor dem Urlaub';

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

const storedJob = {
  id: jobId,
  organization_id: ORGANIZATION_A,
  project_id: null,
  client_id: null,
  site_id: null,
  contact_id: null,
  status: 'nicht_bearbeitet',
  execution_state: null,
  job_number: 'A-2099-101',
  title: 'Heizungstausch Keller',
  description: null,
  priority: 'mittel',
  planned_date: freeDate,
  planned_time: '08:00:00',
  estimated_duration_minutes: 240,
  created_at: now,
  updated_at: now,
};

const world = installActionWorld({
  jobs: [
    storedJob,
    { ...storedJob, id: foreignJobId, organization_id: ORGANIZATION_B, job_number: 'B-2099-001' },
  ],
  job_assignments: [CALLER_ID, mehmetUserId].map((userId, index) => ({
    id: `63000000-0000-4000-8000-00000000010${index}`,
    organization_id: ORGANIZATION_A,
    job_id: jobId,
    user_id: userId,
    assigned_by: CALLER_ID,
    assigned_at: now,
  })),
  // The job's legacy visit at its schedule (08:00 Berlin is 07:00 UTC in November), with its people.
  planning_occurrences: [
    {
      id: visitId,
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      legacy_source_job_id: jobId,
      status: 'scheduled',
      version: 2,
      time_kind: 'timed',
      start_at: `${freeDate}T07:00:00.000Z`,
      end_at: `${freeDate}T11:00:00.000Z`,
      start_date: null,
      end_date_exclusive: null,
      original_start_local: `${freeDate}T08:00`,
      assignments: [
        { employee_record_id: callerRecordId, team_source_id: null },
        { employee_record_id: mehmetRecordId, team_source_id: null },
      ],
    },
  ],
  employee_records: [
    record(callerRecordId, CALLER_ID, null),
    record(erikRecordId, erikUserId, '2099-10-29'),
    record(mehmetRecordId, mehmetUserId, null),
  ],
  // Everyone works eight hours on weekdays, so no missing-schedule warning joins the conflicts.
  work_schedules: [callerRecordId, erikRecordId, mehmetRecordId].map((employeeRecordId, index) => ({
    id: `65000000-0000-4000-8000-00000000010${index}`,
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
      id: '64000000-0000-4000-8000-000000000101',
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
  loadAssignmentEvaluation: async (input: { selectedUserIds: string[]; assessedForDate: string | null }) => ({
    success: true,
    evaluation: {
      jobId: null,
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
// Both job write functions answer with the stored job row.
world.rpc = () => ({ data: storedJob, error: null });

const { createJob, updateJob } = await import('@/lib/jobs/actions');
signInAs(world, 'admin');

/** The visit assessment the one write call carried. */
function sentVisitAssessment(name: string) {
  assert.equal(world.rpcCalls.length, 1, 'the save is one database call');
  const [write] = world.rpcCalls;
  assert.equal(write?.name, name);
  assert.equal(write?.args.p_organization_id, ORGANIZATION_A, 'the organization comes from the session');
  return write?.args.p_visit_assessment;
}

// --- Create: Mehmet is on approved vacation on the planned day. ---
const newJob = {
  title: 'Gastherme Inbetriebnahme',
  jobNumber: 'A-2099-102',
  plannedDate: vacationDate,
  plannedTime: '08:00',
  estimatedDurationMinutes: 120,
  selectedUserIds: [mehmetUserId],
};
const createRefused = await createJob(newJob);
assert.ok(
  !createRefused.success && 'conflicts' in createRefused,
  'the refusal carries the planning conflicts',
);
assert.equal(createRefused.error, 'planning_warning');
assert.deepEqual(
  createRefused.conflicts.map((conflict) => [conflict.kind, conflict.employeeName, conflict.localDate]),
  [
    ['approved_absence', 'Mehmet Aydın', vacationDate],
    ['over_capacity', 'Mehmet Aydın', vacationDate],
  ],
);
assert.equal(world.rpcCalls.length, 0, 'an unconfirmed conflict creates nothing');

const createStale = await createJob({ ...newJob, planningApproval: { fingerprint: 'f'.repeat(64), reason } });
assert.ok(!createStale.success && createStale.error === 'stale_assessment');
assert.equal(world.rpcCalls.length, 0, 'a reason for another assessment creates nothing');

const created = await createJob({
  ...newJob,
  planningApproval: { fingerprint: createRefused.fingerprint, reason },
});
assert.equal(created.success, true);
const createdAssessment = sentVisitAssessment('create_job_with_visit_assessment');
assert.ok(isJsonRecord(createdAssessment));
assert.deepEqual(
  [
    createdAssessment.employee_record_ids,
    createdAssessment.start_at,
    createdAssessment.end_at,
    createdAssessment.start_date,
    createdAssessment.capacity_fingerprint,
    createdAssessment.override_reason,
  ],
  [
    [mehmetRecordId],
    `${vacationDate}T07:00:00.000Z`,
    `${vacationDate}T09:00:00.000Z`,
    null,
    createRefused.fingerprint,
    reason,
  ],
  'the confirmed create sends the assessed visit with the reason',
);

// A job without a date plans no visit: nothing to assess.
world.rpcCalls = [];
const unplanned = await createJob({
  title: 'Angebot vorbereiten',
  jobNumber: 'A-2099-103',
  selectedUserIds: [mehmetUserId],
});
assert.equal(unplanned.success, true);
assert.equal(sentVisitAssessment('create_job_with_visit_assessment'), null);

// --- Edit: moving the visit onto Mehmet's vacation needs the reason. ---
world.rpcCalls = [];
const moveRefused = await updateJob(jobId, { plannedDate: vacationDate });
assert.ok(!moveRefused.success && 'conflicts' in moveRefused);
assert.equal(moveRefused.error, 'planning_warning');
assert.deepEqual(
  moveRefused.conflicts.map((conflict) => [conflict.kind, conflict.employeeName]),
  [
    ['approved_absence', 'Mehmet Aydın'],
    ['over_capacity', 'Mehmet Aydın'],
  ],
);
assert.equal(world.rpcCalls.length, 0, 'an unconfirmed move writes nothing');

const moved = await updateJob(jobId, {
  plannedDate: vacationDate,
  planningApproval: { fingerprint: moveRefused.fingerprint, reason },
});
assert.equal(moved.success, true);
const movedAssessment = sentVisitAssessment('update_job_with_visit_assessment');
assert.ok(isJsonRecord(movedAssessment));
assert.deepEqual(
  [
    movedAssessment.employee_record_ids,
    movedAssessment.start_at,
    movedAssessment.end_at,
    movedAssessment.capacity_fingerprint,
    movedAssessment.override_reason,
  ],
  [
    [callerRecordId, mehmetRecordId],
    `${vacationDate}T07:00:00.000Z`,
    `${vacationDate}T11:00:00.000Z`,
    moveRefused.fingerprint,
    reason,
  ],
  'the moved visit keeps its people and its four hours',
);
assert.equal(world.rpcCalls[0]?.args.p_job_id, jobId);

// Adding Erik, who left before the visit, needs the reason even without a move.
world.rpcCalls = [];
const additionRefused = await updateJob(jobId, { selectedUserIds: [CALLER_ID, mehmetUserId, erikUserId] });
assert.ok(!additionRefused.success && 'conflicts' in additionRefused);
assert.deepEqual(
  additionRefused.conflicts.map((conflict) => [conflict.kind, conflict.employeeName, conflict.localDate]),
  [['outside_employment', 'Erik Lindner', freeDate]],
);
assert.equal(world.rpcCalls.length, 0);

// An edit that neither moves the visit nor adds anyone is assessed by nobody.
const retitled = await updateJob(jobId, { title: 'Heizungstausch Keller und Bad' });
assert.equal(retitled.success, true);
assert.equal(sentVisitAssessment('update_job_with_visit_assessment'), null);

// The visit changed after the server assessed it: save again on the new state.
world.rpcCalls = [];
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'stale_planning_occurrence' } });
assert.deepEqual(await updateJob(jobId, { title: 'Heizungstausch' }), {
  success: false,
  error: 'stale_occurrence',
});
world.rpc = () => ({ data: storedJob, error: null });

// A foreign organization's job is not found, and nothing is assessed or written.
world.rpcCalls = [];
assert.deepEqual(await updateJob(foreignJobId, { plannedDate: vacationDate }), {
  success: false,
  error: 'job_not_found',
});
assert.equal(world.rpcCalls.length, 0);

// An employee neither creates nor edits a job.
signInAs(world, 'employee');
assert.deepEqual(await createJob(newJob), { success: false, error: 'not_authorized' });
assert.deepEqual(await updateJob(jobId, { plannedDate: vacationDate }), {
  success: false,
  error: 'not_authorized',
});
assert.equal(world.rpcCalls.length, 0);
