// Actual maintenance plan and visit-scheduling actions over the in-memory
// database: only managers write, each write is one database call that names the
// caller's organization and the caller, a foreign id is refused by that call,
// and a refusal leaves no second write or compensating delete behind.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const planId = '40000000-0000-4000-8000-000000000001';
const foreignPlanId = '40000000-0000-4000-8000-000000000002';
const dueWorkId = '40000000-0000-4000-8000-000000000003';
const foreignDueWorkId = '40000000-0000-4000-8000-000000000004';
const jobId = '40000000-0000-4000-8000-000000000005';
const idempotencyKey = '40000000-0000-4000-8000-000000000006';
const occurrence = { originalStartLocal: '2026-11-03T09:00', jobId, entryKind: 'job_visit' };

const world = installActionWorld({ planning_occurrences: [] });
// The assessment reads of a new planning entry are owned by lib/planning; here
// it is the materialized single visit the action hands to the database.
mock.module('@/lib/planning/creation', () => ({
  preparePlanningCreation: async () => ({
    success: true,
    series: null,
    occurrences: [occurrence],
    assignments: [],
    capacitySnapshot: {},
    capacityFingerprint: 'capacity',
    qualificationSnapshot: {},
    qualificationFingerprint: 'qualification',
  }),
}));
const { createMaintenancePlan, reviseMaintenancePlan, scheduleMaintenanceVisit, transitionMaintenancePlan } =
  await import('@/lib/maintenance/actions');

const planInput = {
  planId,
  revisionId: '40000000-0000-4000-8000-000000000007',
  clientId: '40000000-0000-4000-8000-000000000008',
  siteId: '40000000-0000-4000-8000-000000000009',
  maintenanceCoverageId: null,
  status: 'active' as const,
  templateVersionId: '40000000-0000-4000-8000-00000000000a',
  effectiveFromDate: '2026-10-01',
  firstDueDate: '2026-11-01',
  intervalMonths: 6,
  dueWindowBeforeDays: 7,
  dueWindowAfterDays: 7,
  plannedDurationMinutes: 90,
  nextDueBasis: 'planned_due_date' as const,
  operationalInstructions: null,
  overlapReason: null,
  reason: 'Wartungsplan angelegt',
  equipmentIds: ['40000000-0000-4000-8000-00000000000b'],
  idempotencyKey,
};
const transitionInput = {
  planId,
  expectedVersion: 2,
  toStatus: 'active',
  reason: 'Plan aktiviert',
  idempotencyKey,
};
const scheduleInput = {
  dueWorkId,
  expectedVersion: 2,
  jobId,
  startsAtLocal: '2026-11-03T09:00',
  durationMinutes: 90,
  idempotencyKey,
};
const writes = [
  () => createMaintenancePlan(planInput),
  () => reviseMaintenancePlan({ ...planInput, expectedVersion: 2 }),
  () => transitionMaintenancePlan(transitionInput),
  () => scheduleMaintenanceVisit(scheduleInput),
];

// Field workers are denied before any database access.
signInAs(world, 'employee');
for (const write of writes) {
  assert.deepEqual(await write(), { success: false, error: 'not_authorized' });
}
assert.equal(world.adminClientRequests, 0);
assert.equal(world.rpcCalls.length, 0);

// The database refuses ids of another organization because the action passes the caller's.
signInAs(world, 'buero');
world.rpc = ({ args }) =>
  args.p_organization_id !== ORGANIZATION_A || args.p_actor_id !== CALLER_ID
    ? { data: null, error: { code: 'P0001', message: 'maintenance_not_authorized' } }
    : args.p_maintenance_plan_id === foreignPlanId
      ? { data: null, error: { code: 'P0001', message: 'maintenance_plan_not_found' } }
      : args.p_maintenance_due_work_id === foreignDueWorkId
        ? { data: null, error: { code: 'P0001', message: 'maintenance_due_not_found' } }
        : { data: { id: planId, status: 'active', version: 3 }, error: null };

for (const [write, expectedError] of [
  [() => createMaintenancePlan({ ...planInput, planId: foreignPlanId }), 'maintenance_plan_not_found'],
  [
    () => reviseMaintenancePlan({ ...planInput, planId: foreignPlanId, expectedVersion: 2 }),
    'maintenance_plan_not_found',
  ],
  [
    () => transitionMaintenancePlan({ ...transitionInput, planId: foreignPlanId }),
    'maintenance_plan_not_found',
  ],
  [
    () => scheduleMaintenanceVisit({ ...scheduleInput, dueWorkId: foreignDueWorkId }),
    'maintenance_due_not_found',
  ],
] as const) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: expectedError });
  assert.equal(world.rpcCalls.length, 1, `${expectedError}: a refused write made a second call`);
}

// A refusal of the due work step is the refusal of the whole write: one call, nothing to undo.
world.rpc = () => ({
  data: null,
  error: { code: 'P0001', message: 'maintenance_generation_horizon_invalid' },
});
world.rpcCalls.length = 0;
assert.deepEqual(await createMaintenancePlan(planInput), {
  success: false,
  error: 'maintenance_generation_horizon_invalid',
});
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'maintenance_stale_version' } });
assert.deepEqual(await scheduleMaintenanceVisit(scheduleInput), {
  success: false,
  error: 'maintenance_stale_version',
});
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['create_maintenance_plan_with_due_work', 'schedule_maintenance_visit'],
);
assert.deepEqual(world.tables.planning_occurrences, []);

// Each clean write is one call with the caller's organization, the caller and a server-side horizon.
world.rpc = () => ({ data: { id: planId, status: 'active', version: 3 }, error: null });
world.rpcCalls.length = 0;
for (const write of writes) {
  assert.deepEqual(await write(), { success: true });
}
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id]),
  [
    ['create_maintenance_plan_with_due_work', ORGANIZATION_A, CALLER_ID],
    ['revise_maintenance_plan_with_due_work', ORGANIZATION_A, CALLER_ID],
    ['transition_maintenance_plan_with_due_work', ORGANIZATION_A, CALLER_ID],
    ['schedule_maintenance_visit', ORGANIZATION_A, CALLER_ID],
  ],
);
for (const call of world.rpcCalls.slice(0, 3)) {
  assert.match(String(call.args.p_through_date), /^\d{4}-\d{2}-\d{2}$/);
}
const scheduled = world.rpcCalls[3];
assert.ok(scheduled);
assert.deepEqual(
  [scheduled.args.p_maintenance_due_work_id, scheduled.args.p_expected_version, scheduled.args.p_occurrence],
  [dueWorkId, 2, occurrence],
);
