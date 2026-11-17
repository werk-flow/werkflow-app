// Actual Servicebericht actions over the in-memory database: a field worker,
// assigned or not, is refused before any database access; Büro neither finds
// another organization's completed visit nor sees it in the report list, and
// a refused report writes nothing and stores no file.
import assert from 'node:assert/strict';
import { ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const foreignDueWorkId = '8f000000-0000-4000-8000-000000000001';
const foreignJobId = '8f000000-0000-4000-8000-000000000002';
const foreignPlanId = '8f000000-0000-4000-8000-000000000003';
const reportId = '8f000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  maintenance_due_work: [
    {
      id: foreignDueWorkId,
      organization_id: ORGANIZATION_B,
      maintenance_plan_id: foreignPlanId,
      maintenance_plan_revision_id: foreignPlanId,
      job_id: foreignJobId,
      status: 'completed',
      scope_outcome: 'complete',
      completed_on: '2026-11-14',
    },
  ],
  maintenance_service_reports: [],
  job_assignments: [{ organization_id: ORGANIZATION_B, job_id: foreignJobId, user_id: 'caller' }],
});
const { createServiceReport } = await import('@/lib/service-reports/actions');
const { getCompletedVisitPage } = await import('@/lib/service-reports/page-actions');

const create = [
  'createServiceReport',
  () => createServiceReport({ dueWorkId: foreignDueWorkId, reportId, replacesReportId: null }),
] as const;
const list = ['getCompletedVisitPage', () => getCompletedVisitPage({ page: 1 })] as const;

// An employee never creates or lists reports; the assigned one downloads the
// filed report from the job's documents (lib/documents/access.ts).
signInAs(world, 'employee');
await assertRefused(world, [create, list], { success: false, error: 'not_authorized' }, 'none');
signInAs(world, 'employee', ORGANIZATION_B);
await assertRefused(world, [create, list], { success: false, error: 'not_authorized' }, 'none');

// Büro of organization A neither reaches nor lists organization B's visit.
signInAs(world, 'buero');
await assertRefused(world, [create], { success: false, error: 'maintenance_due_not_found' }, 'reads');
assert.deepEqual(await getCompletedVisitPage({ page: 1 }), {
  success: true,
  page: { items: [], total: 0, page: 1, pageSize: 20 },
});
