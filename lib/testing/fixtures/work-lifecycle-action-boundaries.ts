// Actual work-lifecycle actions over the in-memory database: an employee
// searches no predecessors, reads no approvals and links none, and is
// refused before the database; every lifecycle read and write names the
// caller's organization and the caller, so the function's org-scoped lookup
// refuses a job, project, blocker or dependency of organization B with one
// call, and the approval list of a foreign target is empty. Nothing changes.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import {
  assertCallerScopedCalls,
  databaseSnapshot,
  installScopedFunctions,
} from './workforce-boundary-support';

const foreignJobId = '88000000-0000-4000-8000-000000000001';
const foreignProjectId = '88000000-0000-4000-8000-000000000002';
const foreignBlockerId = '88000000-0000-4000-8000-000000000003';
const foreignDependencyId = '88000000-0000-4000-8000-000000000004';
const foreignArtifactId = '88000000-0000-4000-8000-000000000005';
const foreignRevisionId = '88000000-0000-4000-8000-000000000006';
const foreignActionId = '88000000-0000-4000-8000-000000000007';
const ownRecordId = '88000000-0000-4000-8000-000000000008';

const world = installActionWorld({
  employee_records: [{ id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  jobs: [{ id: foreignJobId, organization_id: ORGANIZATION_B }],
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B }],
  work_blockers: [
    {
      id: foreignBlockerId,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      state: 'resolved',
      reason: 'material',
      details: null,
      responsible_employee_record_id: '88000000-0000-4000-8000-000000000009',
      next_review_date: '2026-11-02',
    },
  ],
  work_dependencies: [{ id: foreignDependencyId, organization_id: ORGANIZATION_B }],
  work_artifacts: [
    {
      id: foreignArtifactId,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      status: 'approved',
      current_revision_id: foreignRevisionId,
    },
  ],
  work_artifact_revisions: [
    { id: foreignRevisionId, organization_id: ORGANIZATION_B, title: 'Abnahmeprotokoll', revision_number: 1 },
  ],
  work_artifact_actions: [
    {
      id: foreignActionId,
      organization_id: ORGANIZATION_B,
      revision_id: foreignRevisionId,
      action_type: 'internal_approved',
      created_at: '2026-10-01T08:00:00.000Z',
    },
  ],
});
// The lifecycle functions load their target inside the organization they are
// given (supabase/tests/p1_14_*.sql); here only that lookup and its code.
const job = (idArgument: string, refusal: string) => ({ table: 'jobs', idArgument, refusal });
const dependency = {
  table: 'work_dependencies',
  idArgument: 'p_dependency_id',
  refusal: 'work_dependency_not_found',
};
installScopedFunctions(world, {
  get_work_lifecycle_snapshot: {
    table: 'projects',
    idArgument: 'p_target_id',
    refusal: 'work_snapshot_target_not_found',
  },
  transition_work_execution: job('p_target_id', 'work_transition_target_not_found'),
  clear_project_execution_override: {
    table: 'projects',
    idArgument: 'p_project_id',
    refusal: 'work_transition_target_not_found',
  },
  upsert_work_blocker: job('p_job_id', 'work_blocker_target_mismatch'),
  set_work_blocker_state: {
    table: 'work_blockers',
    idArgument: 'p_blocker_id',
    refusal: 'work_blocker_not_found',
  },
  park_work_target: job('p_target_id', 'work_parking_target_not_found'),
  unpark_work_target: job('p_target_id', 'work_parking_target_not_found'),
  upsert_work_dependency: job('p_dependent_job_id', 'work_dependency_not_found'),
  set_declared_work_dependency_state: dependency,
  link_work_dependency_artifact_approval: dependency,
  remove_work_dependency: dependency,
});
const scopedFunctions = world.rpc;
// The predecessor search selects inside the organization it is given; this one finds nothing.
world.rpc = (call) =>
  call.name === 'search_work_predecessor_options' ? { data: [], error: null } : scopedFunctions(call);
const {
  clearProjectWorkExecutionOverride,
  getApprovedArtifactActionsForTarget,
  getWorkLifecycleSnapshot,
  linkWorkDependencyArtifactApproval,
  parkWorkTarget,
  removeWorkDependency,
  reopenWorkBlocker,
  saveWorkBlocker,
  saveWorkDependency,
  searchWorkPredecessors,
  setDeclaredWorkDependencyState,
  setWorkBlockerResolved,
  transitionWorkExecution,
  unparkWorkTarget,
} = await import('@/lib/work-lifecycle/actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const foreignJob = { targetType: 'job' as const, targetId: foreignJobId };
const link = () =>
  linkWorkDependencyArtifactApproval({
    dependencyId: foreignDependencyId,
    expectedVersion: 1,
    actionId: foreignActionId,
    reason: 'Freigabe liegt vor',
  });

// A caller without an organization reopens no blocker.
signInAs(world, null);
const reopen = () =>
  reopenWorkBlocker({ blockerId: foreignBlockerId, expectedVersion: 1, reason: 'Fehlt noch' });
assert.deepEqual(await reopen(), { success: false, error: 'no_active_org' });
assert.equal(world.adminClientRequests, 0);

// An employee searches no predecessors, reads no approvals and links none, before any database access.
signInAs(world, 'employee');
assert.deepEqual(await searchWorkPredecessors({ type: 'job', query: 'Heizung' }), notAuthorized);
assert.deepEqual(await getApprovedArtifactActionsForTarget(foreignJob), notAuthorized);
assert.deepEqual(await link(), notAuthorized);
assert.equal(world.adminClientRequests, 0);

// A snapshot of another organization's project is refused by its scoped read.
assert.deepEqual(await getWorkLifecycleSnapshot({ targetType: 'project', targetId: foreignProjectId }), {
  success: false,
  error: 'work_action_failed',
});
assertCallerScopedCalls(world);

// An Admin of organization A reaches no job, project, blocker or dependency of organization B.
signInAs(world, 'admin');
const writes = [
  () => transitionWorkExecution({ ...foreignJob, expectedVersion: 1, toState: 'in_progress' }),
  () =>
    clearProjectWorkExecutionOverride({
      projectId: foreignProjectId,
      expectedVersion: 1,
      reason: 'Zurücksetzen',
    }),
  () =>
    saveWorkBlocker({
      ...foreignJob,
      reason: 'material',
      responsibleEmployeeRecordId: ownRecordId,
      nextReviewDate: '2026-11-02',
    }),
  () =>
    setWorkBlockerResolved({ blockerId: foreignBlockerId, expectedVersion: 1, resolutionNote: 'Geliefert' }),
  () =>
    parkWorkTarget({
      ...foreignJob,
      expectedExecutionVersion: 1,
      reason: 'material',
      responsibleEmployeeRecordId: ownRecordId,
      nextReviewDate: '2026-11-02',
    }),
  () => unparkWorkTarget({ ...foreignJob, blockerVersion: 1, reason: 'Material da' }),
  () =>
    saveWorkDependency({
      ...foreignJob,
      predecessor: { type: 'declared', kind: 'approval' },
      description: 'Kunde gibt frei',
      effect: 'blocks_start',
    }),
  () =>
    setDeclaredWorkDependencyState({
      dependencyId: foreignDependencyId,
      expectedVersion: 1,
      state: 'satisfied',
      reason: 'Liegt vor',
    }),
  link,
  () => removeWorkDependency({ dependencyId: foreignDependencyId, expectedVersion: 1, reason: 'Entfällt' }),
];
// A foreign blocker is not found by the organization-scoped read, so its reopen calls no function.
world.rpcCalls.length = 0;
assert.deepEqual(await reopen(), { success: false, error: 'work_action_failed' });
assert.equal(world.rpcCalls.length, 0, 'a foreign blocker reached the reopen function');
for (const [index, write] of writes.entries()) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: 'work_action_failed' }, `write ${index}`);
  assert.equal(world.rpcCalls.length, 1, `write ${index}: a refused write made a second call`);
  assertCallerScopedCalls(world);
}

// The approval list of a foreign target is empty, and the predecessor search names the caller's organization.
world.rpcCalls.length = 0;
assert.deepEqual(await getApprovedArtifactActionsForTarget(foreignJob), { success: true, options: [] });
assert.deepEqual(await searchWorkPredecessors({ type: 'job', query: 'Heizung' }), {
  success: true,
  options: [],
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [['search_work_predecessor_options', ORGANIZATION_A]],
);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
