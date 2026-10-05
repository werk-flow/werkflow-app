import 'server-only';

import { z } from '@/lib/zod';

import { formatSiteRowAddress } from '@/lib/clients/types';
import { logReadErrors, logReadFailure } from '@/lib/data/read-request-cache';
import { compareRecordNumbers } from '@/lib/format/record-number';
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
  MaintenanceClientOption,
  MaintenanceCoverageItem,
  MaintenanceDueItem,
  MaintenanceEquipmentOption,
  MaintenancePlanItem,
  MaintenanceRenewalSignal,
  MaintenanceTemplateOption,
  MaintenanceWorkspace,
  MaintenanceWorkspaceResult,
} from './types';
import type { MaintenanceWorkspaceQuery } from './workspace-page';

const LOAD_FAILED = { success: false, error: 'maintenance_load_failed' } as const;

function renewalSignal(reviewDueDate: string | null, today: string): MaintenanceRenewalSignal {
  if (!reviewDueDate) return 'unknown';
  if (reviewDueDate < today) return 'overdue';
  return reviewDueDate <= addLocalDays(today, 30) ? 'due_soon' : 'scheduled';
}

type MaintenanceOptions = Pick<
  MaintenanceWorkspace,
  'clients' | 'templates' | 'followUpOwners' | 'serviceCases' | 'coverageOptions'
>;

/** The editors' option catalogs. Throws after logging a failed read, so no catalog is ever shortened. */
async function loadMaintenanceOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<MaintenanceOptions> {
  const [clientsResult, sitesResult, equipmentResult, versionsResult, membershipsResult, serviceCasesResult] =
    await Promise.all([
      readCompleteRows(
        (from, to) =>
          admin
            .from('clients')
            .select('id, name')
            .eq('organization_id', organizationId)
            .order('name')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
      readCompleteRows(
        (from, to) =>
          admin
            .from('client_sites')
            .select('id, client_id, name, street, postal_code, city, is_active')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .order('name')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
      readCompleteRows(
        (from, to) =>
          admin
            .from('installed_equipment')
            .select('id, site_id, equipment_number, name')
            .eq('organization_id', organizationId)
            .is('archived_at', null)
            .is('voided_at', null)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
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
      // The due dialog filters these by customer and site, so every case of
      // the organization has to be here, not the newest 200.
      readCompleteRows(
        (from, to) =>
          admin
            .from('service_cases')
            .select('id, case_number, summary, client_id, site_id')
            .eq('organization_id', organizationId)
            .order('updated_at', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ]);
  const optionsError =
    clientsResult.error ??
    sitesResult.error ??
    equipmentResult.error ??
    versionsResult.error ??
    membershipsResult.error ??
    serviceCasesResult.error;
  if (optionsError) {
    logReadFailure('loadMaintenanceOptions: option read failed', {
      code: optionsError.code,
      message: optionsError.message,
    });
    throw new Error('maintenance_options_failed');
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
    logReadFailure('loadMaintenanceOptions: template or profile read failed', {
      code: relatedError.code,
      message: relatedError.message,
    });
    throw new Error('maintenance_options_failed');
  }
  const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
  const availableTemplateIds = new Set(
    templatesResult.data
      .filter((template) => template.target_type === 'job' && !template.archived_at)
      .map((template) => template.id),
  );

  const equipmentBySite = new Map<string, MaintenanceEquipmentOption[]>();
  for (const equipment of equipmentResult.data.toSorted((left, right) =>
    compareRecordNumbers(left.equipment_number, right.equipment_number),
  )) {
    const items = equipmentBySite.get(equipment.site_id) ?? [];
    items.push({
      id: equipment.id,
      equipmentNumber: equipment.equipment_number,
      name: equipment.name,
    });
    equipmentBySite.set(equipment.site_id, items);
  }
  const sitesByClient = new Map<string, MaintenanceClientOption['sites']>();
  for (const site of sitesResult.data) {
    const sites = sitesByClient.get(site.client_id) ?? [];
    sites.push({
      id: site.id,
      name: site.name,
      address: formatSiteRowAddress(site),
      equipment: equipmentBySite.get(site.id) ?? [],
    });
    sitesByClient.set(site.client_id, sites);
  }
  return {
    clients: clientsResult.data.map((client) => ({
      id: client.id,
      name: client.name,
      sites: sitesByClient.get(client.id) ?? [],
    })),
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
    serviceCases: serviceCasesResult.data.map((serviceCase) => ({
      id: serviceCase.id,
      caseNumber: serviceCase.case_number,
      summary: serviceCase.summary,
      clientId: serviceCase.client_id,
      siteId: serviceCase.site_id,
    })),
    coverageOptions: await loadCoverageOptions(admin, organizationId),
  };
}

/**
 * Every coverage of the organization for the plan editor, which filters them
 * by customer and site; the coverage list itself is paged. Throws after
 * logging a failed read.
 */
async function loadCoverageOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<MaintenanceOptions['coverageOptions']> {
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('maintenance_coverages')
        .select('id, coverage_number, reference, client_id, site_id')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('loadMaintenanceOptions: coverage read failed', {
      code: error.code,
      message: error.message,
    });
    throw new Error('maintenance_options_failed');
  }
  return data.map((coverage) => ({
    id: coverage.id,
    coverageNumber: coverage.coverage_number,
    reference: coverage.reference,
    clientId: coverage.client_id,
    siteId: coverage.site_id,
  }));
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

/**
 * Names for every site that listed plans and coverages reference. The option
 * catalog holds active sites only; the rest is read by id, so a deactivated
 * site never drops a plan and its due work from the workspace. Null after
 * logging a failed read.
 */
async function readMaintenanceLookups(
  context: ManagerContext,
  options: MaintenanceOptions,
  referencedSiteIds: string[],
): Promise<MaintenanceLookups | null> {
  const siteNames = new Map(
    options.clients.flatMap((client) => client.sites.map((site) => [site.id, site.name] as const)),
  );
  const { data: sites, error } = await readInBatches(
    [...new Set(referencedSiteIds.filter((id) => !siteNames.has(id)))],
    (batch) =>
      context.admin
        .from('client_sites')
        .select('id, name')
        .eq('organization_id', context.organizationId)
        .in('id', [...batch]),
  );
  if (error) {
    logReadErrors('getMaintenanceWorkspace: site lookup failed', error);
    return null;
  }
  for (const site of sites) siteNames.set(site.id, site.name);
  return {
    clientNames: new Map(options.clients.map((client) => [client.id, client.name])),
    siteNames,
    equipment: new Map(
      options.clients.flatMap((client) =>
        client.sites.flatMap((site) => site.equipment.map((item) => [item.id, item] as const)),
      ),
    ),
    templates: new Map(options.templates.map((template) => [template.versionId, template])),
    coverageNumbers: new Map(
      options.coverageOptions.map((coverage) => [coverage.id, coverage.coverageNumber]),
    ),
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
 * equipment and open due work inside the horizon. Null after logging a
 * failed read.
 */
async function readPlanItems(
  context: ManagerContext,
  planRows: Tables<'maintenance_plans'>[],
  throughDate: string,
  lookups: MaintenanceLookups,
): Promise<Map<string, MaintenancePlanItem> | null> {
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
  return items;
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
 * page rows and the editors' catalogs. The caller has established the
 * manager context.
 */
export async function readMaintenanceWorkspace(
  context: ManagerContext,
  query: MaintenanceWorkspaceQuery,
): Promise<MaintenanceWorkspaceResult> {
  const { admin, organizationId } = context;
  const today = formatBerlinLocalDate(new Date());
  const throughDate = addLocalMonthsClamped(today, 18);
  const [selected, options] = await Promise.all([
    admin.rpc('list_maintenance_workspace_page', {
      p_organization_id: organizationId,
      p_due_through: throughDate,
      p_search: query.search,
      p_due_page: query.duePage,
      p_plan_page: query.planPage,
      p_coverage_page: query.coveragePage,
      p_page_size: LIST_PAGE_SIZE,
    }),
    loadMaintenanceOptions(admin, organizationId).catch((error: unknown) => {
      logError('Failed to load maintenance workspace options:', error);
      return null;
    }),
  ]);
  const selection = workspaceSelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getMaintenanceWorkspace: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return LOAD_FAILED;
  }
  if (!options) return LOAD_FAILED;
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
  const lookups = await readMaintenanceLookups(
    context,
    options,
    [...planResult.data, ...coverageRows].map((row) => row.site_id),
  );
  if (!lookups) return LOAD_FAILED;
  const planItems = await readPlanItems(context, planResult.data, throughDate, lookups);
  if (!planItems) return LOAD_FAILED;
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
      ...options,
    },
  };
}
