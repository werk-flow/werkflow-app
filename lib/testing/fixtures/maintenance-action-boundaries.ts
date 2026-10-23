// Actual maintenance workspace, coverage, due-work and evidence actions over
// the in-memory database (plan and visit-scheduling writes are
// maintenance-write-boundaries.ts): a field worker is refused before any
// database access and reads a job's maintenance context only on an own
// assigned job; due work, plans and jobs of another organization are unreachable.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignPlanId = '8e000000-0000-4000-8000-000000000001';
const foreignDueWorkId = '8e000000-0000-4000-8000-000000000002';
const foreignJobId = '8e000000-0000-4000-8000-000000000003';
const foreignSiteId = '8e000000-0000-4000-8000-000000000004';
const ownClientId = '8e000000-0000-4000-8000-000000000005';
const ownServiceCaseId = '8e000000-0000-4000-8000-000000000006';
const revisionId = '8e000000-0000-4000-8000-000000000007';
const coverageId = '8e000000-0000-4000-8000-000000000008';
const idempotencyKey = '8e000000-0000-4000-8000-000000000009';

const world = installActionWorld({
  maintenance_due_work: [
    {
      id: foreignDueWorkId,
      organization_id: ORGANIZATION_B,
      maintenance_plan_id: foreignPlanId,
      job_id: foreignJobId,
      status: 'visit_created',
    },
  ],
  maintenance_due_work_events: [],
  work_artifacts: [
    {
      id: revisionId,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      current_revision_id: revisionId,
    },
  ],
  job_assignments: [],
});
const {
  getMaintenanceWorkspace,
  getMaintenanceCatalogs,
  createMaintenanceCoverage,
  setMaintenancePlanArchived,
  createMaintenanceVisit,
  setMaintenanceDueException,
  completeMaintenanceDueWork,
  linkMaintenanceServiceCase,
  getMaintenanceEvidenceOptions,
  getAssignedMaintenanceContextForJob,
} = await import('@/lib/maintenance/actions');

const reason = 'Kunde hat gekündigt';
const dueChange = { dueWorkId: foreignDueWorkId, expectedVersion: 1, reason, idempotencyKey };
const officeCalls = [
  [
    'getMaintenanceWorkspace',
    () => getMaintenanceWorkspace({ search: '', duePage: 1, planPage: 1, coveragePage: 1 }),
  ],
  ['getMaintenanceCatalogs', () => getMaintenanceCatalogs()],
  [
    'createMaintenanceCoverage',
    () =>
      createMaintenanceCoverage({
        coverageId,
        clientId: ownClientId,
        siteId: foreignSiteId,
        status: 'active',
        idempotencyKey,
      }),
  ],
  [
    'setMaintenancePlanArchived',
    () =>
      setMaintenancePlanArchived({
        planId: foreignPlanId,
        expectedVersion: 1,
        archived: true,
        reason,
        idempotencyKey,
      }),
  ],
  [
    'createMaintenanceVisit',
    () =>
      createMaintenanceVisit({
        dueWorkIds: [foreignDueWorkId],
        expectedVersions: [1],
        reason,
        idempotencyKey,
      }),
  ],
  ['setMaintenanceDueException', () => setMaintenanceDueException({ ...dueChange, toStatus: 'skipped' })],
  [
    'completeMaintenanceDueWork',
    () =>
      completeMaintenanceDueWork({
        ...dueChange,
        scopeOutcome: 'complete',
        completedOn: '2026-10-20',
        workArtifactRevisionIds: [revisionId],
      }),
  ],
  [
    'linkMaintenanceServiceCase',
    () =>
      linkMaintenanceServiceCase({
        planId: foreignPlanId,
        dueWorkId: foreignDueWorkId,
        expectedDueVersion: 1,
        serviceCaseId: ownServiceCaseId,
        reason,
        idempotencyKey,
      }),
  ],
  ['getMaintenanceEvidenceOptions', () => getMaintenanceEvidenceOptions(foreignJobId)],
] as const;
const fieldContext = [
  'getAssignedMaintenanceContextForJob',
  () => getAssignedMaintenanceContextForJob(foreignJobId),
] as const;

// Field workers are refused the office workspace before the service-role
// client exists, and a job they are not assigned to before any due-work read.
signInAs(world, 'employee');
await assertRefused(world, officeCalls, { success: false, error: 'not_authorized' }, 'none');
await assertRefused(world, [fieldContext], { success: false, error: 'not_authorized' }, 'reads');

// Büro does not find another organization's due work, and another
// organization's job shows none of its evidence or maintenance context.
signInAs(world, 'buero');
await assertRefused(world, [officeCalls[4]], { success: false, error: 'maintenance_due_not_found' }, 'reads');
assert.deepEqual(await getMaintenanceEvidenceOptions(foreignJobId), { success: true, options: [] });
assert.deepEqual(await getAssignedMaintenanceContextForJob(foreignJobId), { success: true, contexts: [] });

// The write functions refuse foreign ids under their lock because the action
// passes the caller's organization; one call each.
refuseForeignIds(
  world,
  new Map([
    [foreignPlanId, 'maintenance_plan_not_found'],
    [foreignDueWorkId, 'maintenance_due_not_found'],
    [foreignSiteId, 'maintenance_coverage_site_mismatch'],
  ]),
);
const refusals = [
  [officeCalls[2], 'maintenance_coverage_site_mismatch'],
  [officeCalls[3], 'maintenance_plan_not_found'],
  [officeCalls[5], 'maintenance_due_not_found'],
  [officeCalls[6], 'maintenance_due_not_found'],
  [officeCalls[7], 'maintenance_plan_not_found'],
] as const;
for (const [call, error] of refusals) {
  await assertRefused(world, [call], { success: false, error }, 'one-call');
  assert.equal(
    world.rpcCalls[0]?.args.p_organization_id,
    ORGANIZATION_A,
    `${call[0]}: not the caller's organization`,
  );
}
