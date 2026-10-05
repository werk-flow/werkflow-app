// The actual unparkJobIntoSchedule action over the in-memory database: only
// managers pass, a job of another organization is unreachable, a
// qualification warning changes nothing, and the unpark with its schedule
// write is one database function call (supabase/tests/unpark_into_schedule.sql).
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { AssignmentEvaluation } from '@/lib/qualifications/types';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const jobId = '90000000-0000-4000-8000-000000000401';
const foreignJobId = '90000000-0000-4000-8000-000000000409';
const workerId = '30000000-0000-4000-8000-000000000004';
const now = '2026-10-01T08:00:00.000Z';

const jobRow = (id: string, organizationId: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  project_id: null,
  client_id: null,
  site_id: null,
  contact_id: null,
  job_number: 'J-1',
  title: 'Wartung',
  description: null,
  status: 'geparkt',
  execution_state: null,
  execution_version: 0,
  priority: 'normal',
  planned_date: null,
  planned_time: null,
  estimated_duration_minutes: null,
  planned_working_minutes: null,
  actual_completion_date: null,
  location: null,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
});

const world = installActionWorld({
  jobs: [jobRow(jobId, ORGANIZATION_A), jobRow(foreignJobId, ORGANIZATION_B)],
});

let requiresOverride = true;
const evaluation = (): AssignmentEvaluation => ({
  jobId,
  assessedForDate: '2026-11-02',
  selectedUserIds: [workerId],
  selectedEmployeeRecordIds: ['record-worker'],
  requirementCoverage: [],
  apprenticeWarning: { status: 'not_configured' },
  requiresOverride,
  fingerprint: 'fingerprint-1',
});
const qualifications = await import('@/lib/qualifications/server');
mock.module('@/lib/qualifications/server', () => ({
  ...qualifications,
  loadAssignmentEvaluation: async () => ({ success: true, evaluation: evaluation() }),
}));
const { unparkJobIntoSchedule } = await import('@/lib/work-lifecycle/actions');

const input = {
  jobId,
  blockerVersion: 3,
  reason: 'Im Kalender neu eingeplant',
  schedule: { plannedDate: '2026-11-02', plannedTime: '08:00', selectedUserIds: [workerId] },
};

// A field worker cannot unpark, and malformed input is refused first.
signInAs(world, 'employee');
assert.deepEqual(await unparkJobIntoSchedule(input), { success: false, error: 'not_authorized' });
assert.deepEqual(await unparkJobIntoSchedule({ ...input, jobId: 'not-a-uuid' }), {
  success: false,
  error: 'invalid_input',
});

// A manager never reaches a job of another organization.
signInAs(world, 'buero');
assert.deepEqual(await unparkJobIntoSchedule({ ...input, jobId: foreignJobId }), {
  success: false,
  error: 'job_not_found',
});

// A qualification warning returns before any write: the job stays parked.
const warning = await unparkJobIntoSchedule(input);
assert.equal(warning.success, false);
assert.equal(!warning.success && warning.error, 'qualification_warning');
assert.equal(world.rpcCalls.length, 0, 'a refused or warned caller reaches no database function');

// With the approval, the unpark and the schedule write are one call for the caller's organization.
world.rpc = () => ({
  data: { ...jobRow(jobId, ORGANIZATION_A), status: 'nicht_bearbeitet', planned_date: '2026-11-02' },
  error: null,
});
const approved = await unparkJobIntoSchedule({
  ...input,
  assignmentApproval: { fingerprint: 'fingerprint-1', reason: 'Meister begleitet' },
});
assert.equal(approved.success && approved.job.plannedDate, '2026-11-02');
assert.equal(world.rpcCalls.length, 1);
const [call] = world.rpcCalls;
assert.ok(call);
assert.equal(call.name, 'unpark_job_into_schedule');
assert.deepEqual(
  [
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_job_id,
    call.args.p_expected_blocker_version,
    call.args.p_reason,
    call.args.p_replace_assignments,
    call.args.p_selected_user_ids,
    call.args.p_override_reason,
  ],
  [ORGANIZATION_A, CALLER_ID, jobId, 3, 'Im Kalender neu eingeplant', true, [workerId], 'Meister begleitet'],
);
assert.deepEqual(call.args.p_changes, {
  planned_date: '2026-11-02',
  planned_time: '08:00',
  status: 'nicht_bearbeitet',
});

// Refusals keep their code: the unpark's work codes, the edit's job code, a fallback for the rest.
requiresOverride = false;
for (const [databaseMessage, expectedError] of [
  ['work_blocker_stale_version', 'work_blocker_stale_version'],
  ['work_parking_context_not_found', 'work_action_failed'],
  ['job_not_found', 'job_not_found'],
  ['assignment user is not an organization member', 'update_failed'],
] as const) {
  world.rpc = () => ({ data: null, error: { code: 'P0001', message: databaseMessage } });
  assert.deepEqual(await unparkJobIntoSchedule(input), { success: false, error: expectedError });
}
