// Actual work-handover actions over the in-memory database: only a
// handover-review holder opens, saves, previews, releases, withdraws or
// returns a handover, a holder of organization A reaches no job, project or
// package of organization B, and the field status of a job is read only by a
// manager or a worker assigned to it. A refused call stores no package file,
// calls no write function and changes no row.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertCallerScopedCalls, databaseSnapshot } from './workforce-boundary-support';

const ownJobId = '86000000-0000-4000-8000-000000000001';
const foreignJobId = '86000000-0000-4000-8000-000000000002';
const foreignProjectId = '86000000-0000-4000-8000-000000000003';
const foreignPackageId = '86000000-0000-4000-8000-000000000004';
const requestId = '86000000-0000-4000-8000-000000000005';
const releaseId = '86000000-0000-4000-8000-000000000006';

const job = (id: string, organizationId: string, jobNumber: string) => ({
  id,
  organization_id: organizationId,
  job_number: jobNumber,
  project_id: null,
  title: 'Heizungswartung',
  status: 'in_bearbeitung',
  execution_state: 'in_progress',
  execution_version: 1,
});
const world = installActionWorld({
  employee_records: [
    {
      id: '86000000-0000-4000-8000-0000000000e1',
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      exit_date: null,
    },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' }],
  jobs: [job(ownJobId, ORGANIZATION_A, 'A-100'), job(foreignJobId, ORGANIZATION_B, 'B-200')],
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B, project_number: 'P-200' }],
  work_handover_packages: [{ id: foreignPackageId, organization_id: ORGANIZATION_B, job_id: foreignJobId }],
});
// The state functions load the package inside the organization they are given
// (supabase/tests/p1_17_*.sql); a foreign package is not found there.
world.rpc = ({ name, args }) =>
  args.p_package_id === foreignPackageId && args.p_organization_id !== ORGANIZATION_B
    ? { data: null, error: { code: 'P0001', message: 'work_handover_package_not_found' } }
    : { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
const storedPaths: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  putStorageObject: async ({ path }: { path: string }) => {
    storedPaths.push(path);
  },
  discardStorageObjects: async () => {},
}));
const {
  getWorkHandoverFieldStatus,
  getWorkHandoverWorkspace,
  getWorkHandoverWorkspaceByNumber,
  previewWorkHandover,
  releaseWorkHandover,
  returnWorkHandoverForCorrection,
  saveWorkHandoverDraft,
  withdrawWorkHandover,
} = await import('@/lib/work-handover/actions');

// The responsibility resolution reads the caller's role from the membership rows.
const signInWithMembership = (role: 'employee' | 'admin'): void => {
  signInAs(world, role);
  for (const member of tableRows(world, 'organization_members')) member.role = role;
};
const jobTarget = (targetId: string) => ({ targetType: 'job' as const, targetId });
const save = (targetId: string) =>
  saveWorkHandoverDraft({
    ...jobTarget(targetId),
    packageId: foreignPackageId,
    expectedPackageVersion: 0,
    requestId,
    selectedSourceKeys: [],
  });
const preview = (targetId: string) =>
  previewWorkHandover({
    ...jobTarget(targetId),
    packageId: foreignPackageId,
    expectedPackageVersion: 1,
    releaseId,
  });
const release = (targetId: string) =>
  releaseWorkHandover({
    ...jobTarget(targetId),
    packageId: foreignPackageId,
    expectedPackageVersion: 1,
    releaseId,
    requestId,
    documentId: '86000000-0000-4000-8000-000000000007',
    documentLinkId: '86000000-0000-4000-8000-000000000008',
    expectedExecutionVersion: 1,
    expectedContentHash: 'a'.repeat(64),
    reason: 'Übergabe an Kunden',
    overrideGates: false,
  });
const reopen = {
  ...jobTarget(foreignJobId),
  packageId: foreignPackageId,
  requestId,
  expectedPackageVersion: 1,
  expectedExecutionVersion: 1,
  reason: 'Korrektur nötig',
};

// An employee without the handover-review responsibility opens and changes no handover.
signInWithMembership('employee');
const notHolder = { success: false, error: 'work_handover_not_authorized' };
assert.deepEqual(await getWorkHandoverWorkspace(jobTarget(ownJobId)), notHolder);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'job', targetNumber: 'A-100' }),
  notHolder,
);
assert.deepEqual(await save(ownJobId), notHolder);
assert.deepEqual(await preview(ownJobId), notHolder);
assert.deepEqual(await release(ownJobId), notHolder);
assert.deepEqual(await withdrawWorkHandover(reopen), notHolder);
assert.deepEqual(await returnWorkHandoverForCorrection(reopen), notHolder);
// The field status of a job the employee is not assigned to is refused.
assert.deepEqual(await getWorkHandoverFieldStatus(ownJobId), { success: false, error: 'not_authorized' });
assert.equal(world.rpcCalls.length, 0);

// An Admin of organization A reaches no job, project or package of organization B.
signInWithMembership('admin');
const initialAdminDatabase = databaseSnapshot(world);
const targetNotFound = { success: false, error: 'work_handover_target_not_found' };
assert.deepEqual(await getWorkHandoverWorkspace(jobTarget(foreignJobId)), targetNotFound);
assert.deepEqual(
  await getWorkHandoverWorkspace({ targetType: 'project', targetId: foreignProjectId }),
  targetNotFound,
);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'job', targetNumber: 'B-200' }),
  targetNotFound,
);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'project', targetNumber: 'P-200' }),
  targetNotFound,
);
assert.deepEqual(await save(foreignJobId), targetNotFound);
assert.deepEqual(await preview(foreignJobId), targetNotFound);
assert.deepEqual(await release(foreignJobId), targetNotFound);
assert.deepEqual(await getWorkHandoverFieldStatus(foreignJobId), { success: false, error: 'not_authorized' });
assert.equal(world.rpcCalls.length, 0);
assert.deepEqual(storedPaths, [], 'a refused release stores no package file');

// A withdrawal or return names the caller's organization, so the foreign package is refused by its one call.
for (const change of [withdrawWorkHandover, returnWorkHandoverForCorrection]) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await change(reopen), { success: false, error: 'work_handover_action_failed' });
  assert.equal(world.rpcCalls.length, 1);
  assertCallerScopedCalls(world);
}
assert.equal(databaseSnapshot(world), initialAdminDatabase, 'no refused call may write');
