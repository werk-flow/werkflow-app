// Actual Servicebericht actions over the in-memory database: a field worker,
// assigned or not, is refused before any database access; Büro neither finds
// another organization's completed visit nor sees it in the report list, and
// a refused report writes nothing. A retry of a committed attempt answers with
// its report, also after a newer one, and writes nothing.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const foreignDueWorkId = '8f000000-0000-4000-8000-000000000001';
const foreignJobId = '8f000000-0000-4000-8000-000000000002';
const foreignPlanId = '8f000000-0000-4000-8000-000000000003';
const reportId = '8f000000-0000-4000-8000-000000000004';
const ownDueWorkId = '8f000000-0000-4000-8000-000000000011';
const ownJobId = '8f000000-0000-4000-8000-000000000012';
const ownPlanId = '8f000000-0000-4000-8000-000000000013';
const committedReportId = '8f000000-0000-4000-8000-000000000014';
const committedDocumentId = '8f000000-0000-4000-8000-000000000015';

const completed = { status: 'completed', scope_outcome: 'complete', completed_on: '2026-11-14' };
const world = installActionWorld({
  maintenance_due_work: [
    {
      id: foreignDueWorkId,
      organization_id: ORGANIZATION_B,
      maintenance_plan_id: foreignPlanId,
      maintenance_plan_revision_id: foreignPlanId,
      job_id: foreignJobId,
      ...completed,
    },
    {
      id: ownDueWorkId,
      organization_id: ORGANIZATION_A,
      maintenance_plan_id: ownPlanId,
      maintenance_plan_revision_id: ownPlanId,
      job_id: ownJobId,
      ...completed,
    },
  ],
  maintenance_plans: [
    {
      id: ownPlanId,
      organization_id: ORGANIZATION_A,
      plan_number: 'WPL-1',
      client_id: ownJobId,
      site_id: ownJobId,
    },
  ],
  jobs: [{ id: ownJobId, organization_id: ORGANIZATION_A, job_number: 'A-2026-0042' }],
  clients: [],
  client_sites: [],
  installed_equipment: [],
  maintenance_plan_revision_equipment: [],
  maintenance_due_evidence_links: [],
  maintenance_visit_findings: [],
  maintenance_service_reports: [
    {
      id: committedReportId,
      organization_id: ORGANIZATION_A,
      maintenance_due_work_id: ownDueWorkId,
      document_id: committedDocumentId,
      report_number: 1,
      created_at: '2026-11-17T10:00:00Z',
    },
    // Another manager regenerated it before the first attempt's retry arrived.
    {
      id: '8f000000-0000-4000-8000-000000000016',
      organization_id: ORGANIZATION_A,
      maintenance_due_work_id: ownDueWorkId,
      document_id: '8f000000-0000-4000-8000-000000000017',
      report_number: 2,
      replaces_report_id: committedReportId,
      created_at: '2026-11-17T10:05:00Z',
    },
  ],
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
const page = await getCompletedVisitPage({ page: 1 });
assert.ok(page.success, 'the own list did not load');
assert.deepEqual(
  page.page.items.map((item) => item.dueWorkId),
  [ownDueWorkId],
);
assert.equal(page.page.total, 1);

// The retry of a committed attempt answers with its report, also after a newer one, and writes nothing.
const committed = { success: true, reportId: committedReportId, documentId: committedDocumentId };
world.rpcCalls.length = 0;
assert.deepEqual(
  await createServiceReport({ dueWorkId: ownDueWorkId, reportId: committedReportId, replacesReportId: null }),
  committed,
);
assert.equal(world.rpcCalls.length, 0, 'a retry of a committed attempt wrote again');
