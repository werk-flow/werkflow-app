import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { MaintenanceScopeOutcome } from '@/lib/maintenance/types';
import type { ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';

import type { ServiceReportSource } from './build';
import type { CompletedVisit, CompletedVisitPage } from './types';

// Office reads of completed maintenance visits and their reports. Each runs
// after the caller's manager check with the service role and filters by the
// caller's organization. The report source selects customer-safe columns
// only: never a completion reason, a finding's note or owner, coverage,
// technical notes, warranty or a price.

const COMPLETED_VISIT_PAGE_SIZE = 20;

type LatestReport = NonNullable<CompletedVisit['latestReport']>;

/** The newest report of each visit. */
async function readLatestReports(
  context: ServiceManagerContext,
  dueWorkIds: string[],
): Promise<Map<string, LatestReport> | null> {
  const reports = await readInBatches(dueWorkIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('maintenance_service_reports')
          .select('id, maintenance_due_work_id, document_id, report_number, created_at')
          .eq('organization_id', context.organizationId)
          .in('maintenance_due_work_id', batch)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (reports.error) return null;
  const latest = new Map<string, (typeof reports.data)[number]>();
  for (const report of reports.data) {
    const known = latest.get(report.maintenance_due_work_id);
    if (!known || known.report_number < report.report_number)
      latest.set(report.maintenance_due_work_id, report);
  }
  return new Map(
    [...latest].map(([dueWorkId, report]) => [
      dueWorkId,
      {
        id: report.id,
        documentId: report.document_id,
        reportNumber: report.report_number,
        createdAt: report.created_at,
      },
    ]),
  );
}

type DueRow = {
  id: string;
  completed_on: string | null;
  scope_outcome: MaintenanceScopeOutcome | null;
  job_id: string | null;
  maintenance_plan_id: string;
  maintenance_plan_revision_id: string;
};

const uniqueIds = (rows: Array<string | null>) => [...new Set(rows.filter((id) => id !== null))];
const byId = <Row extends { id: string }>(rows: Row[]) => new Map(rows.map((row) => [row.id, row]));

/** Job, plan, customer, site and Anlage names and the latest report of a page of visits. */
async function readPageLookups(context: ServiceManagerContext, due: DueRow[]) {
  const scope = context.organizationId;
  const [jobs, plans, revisionEquipment, reports] = await Promise.all([
    readInBatches(uniqueIds(due.map((row) => row.job_id)), (batch) =>
      context.admin.from('jobs').select('id, job_number').eq('organization_id', scope).in('id', batch),
    ),
    readInBatches(uniqueIds(due.map((row) => row.maintenance_plan_id)), (batch) =>
      context.admin
        .from('maintenance_plans')
        .select('id, plan_number, client_id, site_id')
        .eq('organization_id', scope)
        .in('id', batch),
    ),
    readInBatches(uniqueIds(due.map((row) => row.maintenance_plan_revision_id)), (batch) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('maintenance_plan_revision_equipment')
            .select('id, maintenance_plan_revision_id, equipment_id')
            .eq('organization_id', scope)
            .in('maintenance_plan_revision_id', batch)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readLatestReports(
      context,
      due.map((row) => row.id),
    ),
  ]);
  if (jobs.error || plans.error || revisionEquipment.error || !reports) return null;
  const [clients, sites, equipment] = await Promise.all([
    readInBatches(uniqueIds(plans.data.map((plan) => plan.client_id)), (batch) =>
      context.admin.from('clients').select('id, name').eq('organization_id', scope).in('id', batch),
    ),
    readInBatches(uniqueIds(plans.data.map((plan) => plan.site_id)), (batch) =>
      context.admin.from('client_sites').select('id, name').eq('organization_id', scope).in('id', batch),
    ),
    readInBatches(uniqueIds(revisionEquipment.data.map((link) => link.equipment_id)), (batch) =>
      context.admin
        .from('installed_equipment')
        .select('id, name')
        .eq('organization_id', scope)
        .in('id', batch),
    ),
  ]);
  if (clients.error || sites.error || equipment.error) return null;
  return {
    jobById: byId(jobs.data),
    planById: byId(plans.data),
    clientById: byId(clients.data),
    siteById: byId(sites.data),
    equipmentById: byId(equipment.data),
    revisionEquipment: revisionEquipment.data,
    reports,
  };
}

type PageLookups = NonNullable<Awaited<ReturnType<typeof readPageLookups>>>;

function completedVisitOf(row: DueRow, lookups: PageLookups): CompletedVisit[] {
  const plan = lookups.planById.get(row.maintenance_plan_id);
  if (!row.completed_on || !row.scope_outcome || !plan) return [];
  return [
    {
      dueWorkId: row.id,
      completedOn: row.completed_on,
      outcome: row.scope_outcome,
      jobNumber: (row.job_id && lookups.jobById.get(row.job_id)?.job_number) || null,
      planNumber: plan.plan_number,
      clientName: lookups.clientById.get(plan.client_id)?.name ?? '',
      siteName: lookups.siteById.get(plan.site_id)?.name ?? '',
      equipmentNames: lookups.revisionEquipment.flatMap((link) =>
        link.maintenance_plan_revision_id === row.maintenance_plan_revision_id
          ? [lookups.equipmentById.get(link.equipment_id)?.name ?? '']
          : [],
      ),
      latestReport: lookups.reports.get(row.id) ?? null,
    },
  ];
}

/** One page of completed visits with a job, newest first, each with its latest report. */
export async function readCompletedVisitPage(
  context: ServiceManagerContext,
  page: number,
): Promise<ActionResult<{ page: CompletedVisitPage }, 'load_failed'>> {
  const from = (page - 1) * COMPLETED_VISIT_PAGE_SIZE;
  const dueRead = await loggedRead(
    'readCompletedVisitPage: due work read failed',
    context.admin
      .from('maintenance_due_work')
      .select('id, completed_on, scope_outcome, job_id, maintenance_plan_id, maintenance_plan_revision_id', {
        count: 'exact',
      })
      .eq('organization_id', context.organizationId)
      .eq('status', 'completed')
      .not('job_id', 'is', null)
      .order('completed_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + COMPLETED_VISIT_PAGE_SIZE - 1),
  );
  if (dueRead.error) return { success: false, error: 'load_failed' };
  const lookups = await readPageLookups(context, dueRead.data);
  if (!lookups) return { success: false, error: 'load_failed' };
  const items = dueRead.data.flatMap((row) => completedVisitOf(row, lookups));
  return {
    success: true,
    page: { items, total: dueRead.count ?? items.length, page, pageSize: COMPLETED_VISIT_PAGE_SIZE },
  };
}

/** The report an attempt registered for this visit, so its retry answers with it; null before it committed. */
export async function readAttemptReport(
  context: ServiceManagerContext,
  dueWorkId: string,
  reportId: string,
): Promise<ActionResult<{ report: { id: string; documentId: string } | null }, 'load_failed'>> {
  const { data, error } = await loggedRead(
    'readAttemptReport: report read failed',
    context.admin
      .from('maintenance_service_reports')
      .select('id, document_id')
      .eq('organization_id', context.organizationId)
      .eq('maintenance_due_work_id', dueWorkId)
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  return { success: true, report: data && { id: data.id, documentId: data.document_id } };
}

/** What a report of one completed visit prints, except the recipient, which the job's billing parties name. */
export type VisitReportFacts = Omit<ServiceReportSource, 'issuedOn' | 'recipient' | 'site'> & {
  jobId: string;
  latestReport: LatestReport | null;
};

/** The Anlagen of a plan revision, in Anlage number order. */
async function readReportEquipment(
  context: ServiceManagerContext,
  revisionId: string,
): Promise<ServiceReportSource['equipment'] | null> {
  const links = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('maintenance_plan_revision_equipment')
        .select('id, equipment_id')
        .eq('organization_id', context.organizationId)
        .eq('maintenance_plan_revision_id', revisionId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (links.error) return null;
  const equipment = await readInBatches(
    links.data.map((link) => link.equipment_id),
    (batch) =>
      context.admin
        .from('installed_equipment')
        .select('id, name, equipment_number, manufacturer, model, location_detail')
        .eq('organization_id', context.organizationId)
        .in('id', batch)
        .order('equipment_number'),
  );
  if (equipment.error) return null;
  return equipment.data.map((item) => ({
    name: item.name,
    equipmentNumber: item.equipment_number,
    manufacturer: item.manufacturer,
    model: item.model,
    locationDetail: item.location_detail,
  }));
}

/** The visit's evidence revisions in link order, with their readings and the customer's signature. */
async function readReportEvidence(
  context: ServiceManagerContext,
  dueWorkId: string,
): Promise<ServiceReportSource['evidence'] | null> {
  const scope = context.organizationId;
  const links = await readCompleteRows(
    (from, to) =>
      context.admin
        .from('maintenance_due_evidence_links')
        .select('work_artifact_revision_id, created_at')
        .eq('organization_id', scope)
        .eq('maintenance_due_work_id', dueWorkId)
        .order('created_at')
        .order('work_artifact_revision_id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (links.error) return null;
  const revisionIds = links.data.map((link) => link.work_artifact_revision_id);
  const [revisions, readings, signatures] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      context.admin
        .from('work_artifact_revisions')
        .select('id, visibility, performed_work')
        .eq('organization_id', scope)
        .in('id', batch),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('work_artifact_measurement_lines')
            .select('id, revision_id, line_number, description, location, quantity, unit')
            .eq('organization_id', scope)
            .in('revision_id', batch)
            .order('line_number')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('work_artifact_actions')
            .select('id, revision_id, signer_name, created_at')
            .eq('organization_id', scope)
            .eq('action_type', 'signature_captured')
            .in('revision_id', batch)
            .order('created_at')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (revisions.error || readings.error || signatures.error) return null;
  const revisionById = byId(revisions.data);
  return revisionIds.flatMap((revisionId) => {
    const revision = revisionById.get(revisionId);
    if (!revision) return [];
    const signature = signatures.data.find(
      (action) => action.revision_id === revisionId && action.signer_name,
    );
    return [
      {
        visibility: revision.visibility,
        performedWork: revision.performed_work,
        readings: readings.data
          .filter((line) => line.revision_id === revisionId)
          .map(({ description, location, quantity, unit }) => ({ description, location, quantity, unit })),
        signature: signature?.signer_name
          ? { signerName: signature.signer_name, signedAt: signature.created_at }
          : null,
      },
    ];
  });
}

/** The customer-safe facts of one completed visit of the caller's organization. */
export async function readVisitReportFacts(
  context: ServiceManagerContext,
  dueWorkId: string,
): Promise<
  ActionResult<
    { facts: VisitReportFacts },
    'load_failed' | 'maintenance_due_not_found' | 'service_report_visit_not_completed'
  >
> {
  const dueRead = await loggedRead(
    'readVisitReportFacts: due work read failed',
    context.admin
      .from('maintenance_due_work')
      .select('id, status, completed_on, scope_outcome, job_id, maintenance_plan_revision_id')
      .eq('organization_id', context.organizationId)
      .eq('id', dueWorkId)
      .maybeSingle(),
  );
  if (dueRead.error) return { success: false, error: 'load_failed' };
  const due = dueRead.data;
  if (!due) return { success: false, error: 'maintenance_due_not_found' };
  if (due.status !== 'completed' || !due.job_id || !due.completed_on || !due.scope_outcome) {
    return { success: false, error: 'service_report_visit_not_completed' };
  }
  const [job, equipment, evidence, finding, reports] = await Promise.all([
    context.admin
      .from('jobs')
      .select('job_number')
      .eq('organization_id', context.organizationId)
      .eq('id', due.job_id)
      .maybeSingle(),
    readReportEquipment(context, due.maintenance_plan_revision_id),
    readReportEvidence(context, due.id),
    context.admin
      .from('maintenance_visit_findings')
      .select('defects, next_action, target_date')
      .eq('organization_id', context.organizationId)
      .eq('maintenance_due_work_id', due.id)
      .maybeSingle(),
    readLatestReports(context, [due.id]),
  ]);
  if (job.error || !equipment || !evidence || finding.error || !reports) {
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    facts: {
      jobId: due.job_id,
      latestReport: reports.get(due.id) ?? null,
      completedOn: due.completed_on,
      scopeOutcome: due.scope_outcome,
      jobNumber: job.data?.job_number ?? null,
      equipment,
      evidence,
      finding: finding.data && {
        defects: finding.data.defects,
        nextAction: finding.data.next_action,
        targetDate: finding.data.target_date,
      },
    },
  };
}
