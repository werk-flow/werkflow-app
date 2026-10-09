import 'server-only';

import { z } from '@/lib/zod';

import { logReadErrors, logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { addLocalDays, addLocalMonthsClamped, formatBerlinLocalDate } from '@/lib/planning/date-time';
import type {
  ServiceAdminClient as AdminClient,
  ServiceManagerContext as ManagerContext,
} from '@/lib/service-cases/manager-context';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import type {
  MaintenanceCatalogs,
  MaintenanceCoverageItem,
  MaintenanceDueItem,
  MaintenanceEquipmentOption,
  MaintenancePlanItem,
  MaintenanceRenewalSignal,
  MaintenanceTemplateOption,
  MaintenanceWorkspaceResult,
} from './types';
import type { MaintenanceWorkspaceQuery } from './workspace-page';

const LOAD_FAILED = { success: false, error: 'maintenance_load_failed' } as const;

function renewalSignal(reviewDueDate: string | null, today: string): MaintenanceRenewalSignal {
  if (!reviewDueDate) return 'unknown';
  if (reviewDueDate < today) return 'overdue';
  return reviewDueDate <= addLocalDays(today, 30) ? 'due_soon' : 'scheduled';
}

/**
 * The published job templates and the follow-up owners: small, complete
 * catalogs the page reads once, outside the live refresh of the lists. Null
 * after logging a failed read, so a catalog is never shortened.
 */
export async function loadMaintenanceCatalogs(
  admin: AdminClient,
  organizationId: string,
): Promise<MaintenanceCatalogs | null> {
  const [versionsResult, membershipsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('work_template_versions')
          .select('id, template_id, name, version_number')
          .eq('organization_id', organizationId)
          .eq('status', 'published')
          .order('name')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_members')
          .select('user_id, role')
          .eq('organization_id', organizationId)
          .in('role', ['admin', 'buero'])
          .order('user_id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  const catalogError = versionsResult.error ?? membershipsResult.error;
  if (catalogError) {
    logReadFailure('loadMaintenanceCatalogs: catalog read failed', {
      code: catalogError.code,
      message: catalogError.message,
    });
    return null;
  }
  const [templatesResult, profilesResult] = await Promise.all([
    readInBatches(
      versionsResult.data.map((row) => row.template_id),
      (batch) =>
        admin
          .from('work_templates')
          .select('id, target_type, archived_at')
          .eq('organization_id', organizationId)
          .in('id', [...batch]),
    ),
    readInBatches(
      membershipsResult.data.map((member) => member.user_id),
      (batch) =>
        admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', [...batch]),
    ),
  ]);
  const relatedError = templatesResult.error ?? profilesResult.error;
  if (relatedError) {
    logReadFailure('loadMaintenanceCatalogs: template or profile read failed', {
      code: relatedError.code,
      message: relatedError.message,
    });
    return null;
  }
  const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
  const availableTemplateIds = new Set(
    templatesResult.data
      .filter((template) => template.target_type === 'job' && !template.archived_at)
      .map((template) => template.id),
  );
  return {
    templates: versionsResult.data
      .filter((version) => availableTemplateIds.has(version.template_id))
      .map((version) => ({
        versionId: version.id,
        name: version.name,
        versionNumber: version.version_number,
      })),
    followUpOwners: membershipsResult.data
      .map((member) => {
        const profile = profiles.get(member.user_id);
        return {
          userId: member.user_id,
          role: member.role as 'admin' | 'buero',
          name:
            [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
            profile?.email ||
            'Unbekannte Person',
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'de')),
  };
}

type MaintenanceLookups = {
  clientNames: Map<string, string>;
  /** Every site a listed plan or coverage names, including deactivated sites. */
  siteNames: Map<string, string>;
  /** Active equipment only: the plan editor offers and keeps these. */
  equipment: Map<string, MaintenanceEquipmentOption>;
  templates: Map<string, MaintenanceTemplateOption>;
  coverageNumbers: Map<string, string>;
};

type LookupIds = {
  clientIds: string[];
  siteIds: string[];
  equipmentIds: string[];
  templateVersionIds: string[];
  coverageIds: string[];
};

const unique = (ids: string[]): string[] => [...new Set(ids)];

/**
 * Names and numbers of the records the listed rows reference, read by id: a
 * page never carries the customers, sites or equipment of the whole
 * organization. Null after logging a failed read.
 */
async function readMaintenanceLookups(
  context: ManagerContext,
  ids: LookupIds,
): Promise<MaintenanceLookups | null> {
  const { admin, organizationId } = context;
  const [clients, sites, equipment, versions, coverages] = await Promise.all([
    readInBatches(unique(ids.clientIds), (batch) =>
      admin
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(unique(ids.siteIds), (batch) =>
      admin
        .from('client_sites')
        .select('id, name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(unique(ids.equipmentIds), (batch) =>
      admin
        .from('installed_equipment')
        .select('id, equipment_number, name')
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .is('voided_at', null)
        .in('id', [...batch]),
    ),
    readInBatches(unique(ids.templateVersionIds), (batch) =>
      admin
        .from('work_template_versions')
        .select('id, name, version_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(unique(ids.coverageIds), (batch) =>
      admin
        .from('maintenance_coverages')
        .select('id, coverage_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (clients.error || sites.error || equipment.error || versions.error || coverages.error) {
    logReadErrors(
      'getMaintenanceWorkspace: lookup read failed',
      clients.error,
      sites.error,
      equipment.error,
      versions.error,
      coverages.error,
    );
    return null;
  }
  return {
    clientNames: new Map(clients.data.map((client) => [client.id, client.name])),
    siteNames: new Map(sites.data.map((site) => [site.id, site.name])),
    equipment: new Map(
      equipment.data.map((item) => [
        item.id,
        { id: item.id, equipmentNumber: item.equipment_number, name: item.name },
      ]),
    ),
    templates: new Map(
      versions.data.map((version) => [
        version.id,
        { versionId: version.id, name: version.name, versionNumber: version.version_number },
      ]),
    ),
    coverageNumbers: new Map(coverages.data.map((coverage) => [coverage.id, coverage.coverage_number])),
  };
}

type OpenDueDate = Pick<Tables<'maintenance_due_work'>, 'maintenance_plan_id' | 'due_date'>;

function toMaintenancePlanItem(
  plan: Tables<'maintenance_plans'>,
  revision: Tables<'maintenance_plan_revisions'>,
  equipmentIds: string[],
  openDue: OpenDueDate[],
  lookups: MaintenanceLookups,
): MaintenancePlanItem {
  return {
    id: plan.id,
    planNumber: plan.plan_number,
    clientId: plan.client_id,
    clientName: lookups.clientNames.get(plan.client_id) ?? 'Unbekannter Kunde',
    siteId: plan.site_id,
    siteName: lookups.siteNames.get(plan.site_id) ?? 'Unbekannter Einsatzort',
    maintenanceCoverageId: plan.maintenance_coverage_id,
    coverageNumber: plan.maintenance_coverage_id
      ? (lookups.coverageNumbers.get(plan.maintenance_coverage_id) ?? null)
      : null,
    status: plan.status,
    version: plan.version,
    archivedAt: plan.archived_at,
    generationThroughDate: plan.generation_through_date,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    templateVersionId: revision.template_version_id,
    templateName: lookups.templates.get(revision.template_version_id)?.name ?? 'Arbeitsvorlage',
    effectiveFromDate: revision.effective_from_date,
    firstDueDate: revision.first_due_date,
    intervalMonths: revision.interval_months,
    dueWindowBeforeDays: revision.due_window_before_days,
    dueWindowAfterDays: revision.due_window_after_days,
    plannedDurationMinutes: revision.planned_duration_minutes,
    nextDueBasis: revision.next_due_basis,
    operationalInstructions: revision.operational_instructions,
    overlapReason: revision.overlap_reason,
    equipment: equipmentIds.flatMap((id) => {
      const item = lookups.equipment.get(id);
      return item ? [item] : [];
    }),
    openDueCount: openDue.length,
    nextDueDate: openDue[0]?.due_date ?? null,
  };
}

function toMaintenanceDueItem(
  due: Tables<'maintenance_due_work'>,
  plan: MaintenancePlanItem,
  jobNumbers: Map<string, string>,
): MaintenanceDueItem {
  return {
    id: due.id,
    planId: due.maintenance_plan_id,
    planNumber: plan.planNumber,
    clientId: plan.clientId,
    clientName: plan.clientName,
    siteId: plan.siteId,
    siteName: plan.siteName,
    dueDate: due.due_date,
    windowStartDate: due.window_start_date,
    windowEndDate: due.window_end_date,
    status: due.status,
    jobId: due.job_id,
    jobNumber: due.job_id ? (jobNumbers.get(due.job_id) ?? null) : null,
    planningOccurrenceId: due.planning_occurrence_id,
    scopeOutcome: due.scope_outcome,
    completedOn: due.completed_on,
    exceptionReason: due.exception_reason,
    version: due.version,
    equipment: plan.equipment,
    plannedDurationMinutes: plan.plannedDurationMinutes,
  };
}

function groupBy<Row>(rows: Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  return groups;
}

/** Rows in the order of the selected ids; a row deleted since the selection is skipped. */
function inSelectionOrder<Row extends { id: string }>(ids: string[], rows: Row[]): Row[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/**
 * The plan items of the given plans with their current revision, active
 * equipment and open due work inside the horizon, plus the lookups of every
 * record the page references (the caller's ids and the plans' own). Null
 * after logging a failed read.
 */
async function readPlanItems(
  context: ManagerContext,
  planRows: Tables<'maintenance_plans'>[],
  throughDate: string,
  pageIds: Pick<LookupIds, 'clientIds' | 'siteIds'>,
): Promise<{ items: Map<string, MaintenancePlanItem>; lookups: MaintenanceLookups } | null> {
  const { admin, organizationId } = context;
  const planIds = planRows.map((plan) => plan.id);
  const revisionIds = planRows.flatMap((plan) =>
    plan.current_revision_id ? [plan.current_revision_id] : [],
  );
  const [revisionsResult, equipmentLinksResult, openDueResult] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      admin
        .from('maintenance_plan_revisions')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('maintenance_plan_revision_equipment')
            .select('maintenance_plan_revision_id, equipment_id')
            .eq('organization_id', organizationId)
            .in('maintenance_plan_revision_id', [...batch])
            .order('maintenance_plan_revision_id')
            .order('equipment_id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    // One plan sits in exactly one batch, so its due dates stay ascending.
    readInBatches(planIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('maintenance_due_work')
            .select('maintenance_plan_id, due_date')
            .eq('organization_id', organizationId)
            .in('maintenance_plan_id', [...batch])
            .in('status', ['open', 'visit_created'])
            .lte('due_date', throughDate)
            .order('maintenance_plan_id')
            .order('due_date')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const relatedError = revisionsResult.error ?? equipmentLinksResult.error ?? openDueResult.error;
  if (relatedError) {
    logReadFailure('getMaintenanceWorkspace: revision, equipment or due read failed', {
      code: relatedError.code,
      message: relatedError.message,
    });
    return null;
  }
  const revisions = new Map(revisionsResult.data.map((row) => [row.id, row]));
  const equipmentIdsByRevision = groupBy(
    equipmentLinksResult.data,
    (link) => link.maintenance_plan_revision_id,
  );
  const openDueByPlan = groupBy(openDueResult.data, (due) => due.maintenance_plan_id);
  const lookups = await readMaintenanceLookups(context, {
    clientIds: [...pageIds.clientIds, ...planRows.map((plan) => plan.client_id)],
    siteIds: [...pageIds.siteIds, ...planRows.map((plan) => plan.site_id)],
    equipmentIds: equipmentLinksResult.data.map((link) => link.equipment_id),
    templateVersionIds: revisionsResult.data.map((revision) => revision.template_version_id),
    coverageIds: planRows.flatMap((plan) =>
      plan.maintenance_coverage_id ? [plan.maintenance_coverage_id] : [],
    ),
  });
  if (!lookups) return null;
  const items = new Map<string, MaintenancePlanItem>();
  for (const plan of planRows) {
    const revision = plan.current_revision_id ? revisions.get(plan.current_revision_id) : undefined;
    if (!revision) {
      logError('Maintenance plan without its current revision:', 'missing_revision');
      continue;
    }
    items.set(
      plan.id,
      toMaintenancePlanItem(
        plan,
        revision,
        (equipmentIdsByRevision.get(revision.id) ?? []).map((link) => link.equipment_id),
        openDueByPlan.get(plan.id) ?? [],
        lookups,
      ),
    );
  }
  return { items, lookups };
}

const listSelectionSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  ids: z.array(uuidSchema).max(LIST_PAGE_SIZE),
});
const workspaceSelectionSchema = z.object({
  due: listSelectionSchema,
  plans: listSelectionSchema,
  coverages: listSelectionSchema,
});

/**
 * One page of each workspace list. The database applies the search, the
 * horizon and the counts before the page boundary; this reader hydrates the
 * page rows and the names they reference. The caller has established the
 * manager context.
 */
export async function readMaintenanceWorkspace(
  context: ManagerContext,
  query: MaintenanceWorkspaceQuery,
): Promise<MaintenanceWorkspaceResult> {
  const { admin, organizationId } = context;
  const today = formatBerlinLocalDate(new Date());
  const throughDate = addLocalMonthsClamped(today, 18);
  const selected = await admin.rpc('list_maintenance_workspace_page', {
    p_organization_id: organizationId,
    p_due_through: throughDate,
    p_search: query.search,
    p_due_page: query.duePage,
    p_plan_page: query.planPage,
    p_coverage_page: query.coveragePage,
    p_page_size: LIST_PAGE_SIZE,
  });
  const selection = workspaceSelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getMaintenanceWorkspace: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return LOAD_FAILED;
  }
  const { due, plans, coverages } = selection.data;

  const [dueResult, coverageResult] = await Promise.all([
    readInBatches(due.ids, (batch) =>
      admin
        .from('maintenance_due_work')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(coverages.ids, (batch) =>
      admin
        .from('maintenance_coverages')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (dueResult.error || coverageResult.error) {
    logReadErrors('getMaintenanceWorkspace: page rows read failed', dueResult.error, coverageResult.error);
    return LOAD_FAILED;
  }
  const dueRows = inSelectionOrder(due.ids, dueResult.data);
  const coverageRows = inSelectionOrder(coverages.ids, coverageResult.data);
  // The due page names plans of other plan pages; their items carry the
  // plan's number, customer, site, equipment and visit duration.
  const planIds = [...new Set([...plans.ids, ...dueRows.map((row) => row.maintenance_plan_id)])];
  const jobIds = dueRows.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const [planResult, jobResult] = await Promise.all([
    readInBatches(planIds, (batch) =>
      admin
        .from('maintenance_plans')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (planResult.error || jobResult.error) {
    logReadErrors('getMaintenanceWorkspace: plan or job read failed', planResult.error, jobResult.error);
    return LOAD_FAILED;
  }
  const planData = await readPlanItems(context, planResult.data, throughDate, {
    clientIds: coverageRows.map((row) => row.client_id),
    siteIds: coverageRows.map((row) => row.site_id),
  });
  if (!planData) return LOAD_FAILED;
  const { items: planItems, lookups } = planData;
  const jobNumbers = new Map(
    jobResult.data.flatMap((job) => (job.job_number ? [[job.id, job.job_number] as const] : [])),
  );
  return {
    success: true,
    workspace: {
      plans: plans.ids.flatMap((id) => {
        const item = planItems.get(id);
        return item ? [item] : [];
      }),
      dueWork: dueRows.flatMap((row) => {
        const plan = planItems.get(row.maintenance_plan_id);
        return plan ? [toMaintenanceDueItem(row, plan, jobNumbers)] : [];
      }),
      coverages: coverageRows.map(
        (coverage): MaintenanceCoverageItem => ({
          id: coverage.id,
          coverageNumber: coverage.coverage_number,
          clientId: coverage.client_id,
          clientName: lookups.clientNames.get(coverage.client_id) ?? 'Unbekannter Kunde',
          siteId: coverage.site_id,
          siteName: lookups.siteNames.get(coverage.site_id) ?? 'Unbekannter Einsatzort',
          reference: coverage.reference,
          description: coverage.description,
          status: coverage.status,
          validFrom: coverage.valid_from,
          validUntil: coverage.valid_until,
          noticeDate: coverage.notice_date,
          renewalDate: coverage.renewal_date,
          reviewDueDate: coverage.review_due_date,
          operationalNote: coverage.operational_note,
          renewalSignal: renewalSignal(coverage.review_due_date, today),
          version: coverage.version,
        }),
      ),
      totals: {
        due: { total: due.total, hasAny: due.hasAny },
        plans: { total: plans.total, hasAny: plans.hasAny },
        coverages: { total: coverages.total, hasAny: coverages.hasAny },
      },
      currentActorId: context.actorId,
    },
  };
}
