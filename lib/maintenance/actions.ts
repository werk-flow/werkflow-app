"use server";

import { revalidatePath } from "next/cache";

import { authenticateAndAuthorize } from "@/lib/jobs/auth";
import { createJob, getNextJobNumber } from "@/lib/jobs/actions";
import {
  addLocalDays,
  addLocalMonthsClamped,
  formatBerlinLocalDate,
} from "@/lib/planning/date-time";
import { createPlanningEntry } from "@/lib/planning/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type {
  FieldMaintenanceContext,
  MaintenanceActionResult,
  MaintenanceClientOption,
  MaintenanceCoverageInput,
  MaintenanceCoverageItem,
  MaintenanceDueItem,
  MaintenanceEquipmentOption,
  MaintenanceEvidenceOption,
  MaintenanceJobOption,
  MaintenancePlanInput,
  MaintenancePlanItem,
  MaintenanceTemplateOption,
  MaintenanceWorkspace,
  MaintenanceWorkspaceResult,
} from "./types";
import {
  maintenanceCompletionSchema,
  maintenanceCoverageSchema,
  maintenanceExceptionSchema,
  maintenancePlanSchema,
  maintenanceScheduleSchema,
  maintenanceTransitionSchema,
  maintenanceVisitLinkSchema,
} from "./validation";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ManagerContext = {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
};

function renewalSignal(
  reviewDueDate: string | null,
  today: string,
): "unknown" | "scheduled" | "due_soon" | "overdue" {
  if (!reviewDueDate) return "unknown";
  if (reviewDueDate < today) return "overdue";
  return reviewDueDate <= addLocalDays(today, 30) ? "due_soon" : "scheduled";
}

async function requireMaintenanceManager(): Promise<
  ManagerContext | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: "not_authorized" };
  }
  return {
    admin: createSupabaseAdminClient(),
    organizationId: auth.context.orgId,
    actorId: auth.context.userId,
  };
}

function mutationError(
  error: { message?: string } | null,
  fallback: string,
): string {
  const known = [
    "maintenance_not_authorized",
    "maintenance_idempotency_conflict",
    "maintenance_stale_version",
    "maintenance_reason_required",
    "maintenance_coverage_not_found",
    "maintenance_coverage_site_mismatch",
    "maintenance_plan_not_found",
    "maintenance_plan_site_mismatch",
    "maintenance_plan_coverage_mismatch",
    "maintenance_plan_equipment_mismatch",
    "maintenance_template_version_unavailable",
    "maintenance_overlap_reason_required",
    "maintenance_plan_transition_not_allowed",
    "maintenance_plan_archive_requires_terminated",
    "maintenance_plan_generation_not_allowed",
    "maintenance_generation_horizon_invalid",
    "maintenance_due_not_found",
    "maintenance_due_batch_invalid",
    "maintenance_due_visit_not_allowed",
    "maintenance_due_job_mismatch",
    "maintenance_due_occurrence_mismatch",
    "maintenance_due_exception_not_allowed",
    "maintenance_due_completion_not_allowed",
    "maintenance_completion_date_invalid",
    "maintenance_due_evidence_required",
    "maintenance_due_evidence_mismatch",
  ];
  return known.find((value) => error?.message?.includes(value)) ?? fallback;
}

function formatAddress(site: {
  street: string | null;
  postal_code: string | null;
  city: string | null;
}): string {
  return [site.street, [site.postal_code, site.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

function refreshMaintenancePaths(): void {
  revalidatePath("/service/wartung");
  revalidatePath("/auftraege");
  revalidatePath("/kalender");
}

async function loadMaintenanceOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<{
  clients: MaintenanceClientOption[];
  templates: MaintenanceTemplateOption[];
  jobs: MaintenanceJobOption[];
  followUpOwners: MaintenanceWorkspace["followUpOwners"];
  serviceCases: MaintenanceWorkspace["serviceCases"];
}> {
  const [
    clientsResult,
    sitesResult,
    equipmentResult,
    versionsResult,
    jobsResult,
    membershipsResult,
    serviceCasesResult,
  ] = await Promise.all([
    admin
      .from("clients")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("client_sites")
      .select("id, client_id, name, street, postal_code, city, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name"),
    admin
      .from("installed_equipment")
      .select("id, site_id, equipment_number, name")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .is("voided_at", null)
      .order("equipment_number"),
    admin
      .from("work_template_versions")
      .select("id, template_id, name, version_number")
      .eq("organization_id", organizationId)
      .eq("status", "published")
      .order("name"),
    admin
      .from("jobs")
      .select("id, job_number, title, client_id, site_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(200),
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .in("role", ["admin", "buero"]),
    admin
      .from("service_cases")
      .select("id, case_number, summary, client_id, site_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);
  if (
    clientsResult.error ||
    sitesResult.error ||
    equipmentResult.error ||
    versionsResult.error ||
    jobsResult.error ||
    membershipsResult.error ||
    serviceCasesResult.error
  ) {
    throw new Error("maintenance_options_failed");
  }

  const templateIds = [
    ...new Set((versionsResult.data ?? []).map((row) => row.template_id)),
  ];
  const templatesResult = templateIds.length
    ? await admin
        .from("work_templates")
        .select("id, target_type, archived_at")
        .eq("organization_id", organizationId)
        .in("id", templateIds)
    : { data: [], error: null };
  if (templatesResult.error) throw new Error("maintenance_options_failed");
  const ownerIds = (membershipsResult.data ?? []).map(
    (member) => member.user_id,
  );
  const profilesResult = ownerIds.length
    ? await admin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", ownerIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error("maintenance_options_failed");
  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  const availableTemplateIds = new Set(
    (templatesResult.data ?? [])
      .filter(
        (template) => template.target_type === "job" && !template.archived_at,
      )
      .map((template) => template.id),
  );

  const equipmentBySite = new Map<string, MaintenanceEquipmentOption[]>();
  for (const equipment of equipmentResult.data ?? []) {
    const items = equipmentBySite.get(equipment.site_id) ?? [];
    items.push({
      id: equipment.id,
      equipmentNumber: equipment.equipment_number,
      name: equipment.name,
    });
    equipmentBySite.set(equipment.site_id, items);
  }
  const sitesByClient = new Map<string, MaintenanceClientOption["sites"]>();
  for (const site of sitesResult.data ?? []) {
    const sites = sitesByClient.get(site.client_id) ?? [];
    sites.push({
      id: site.id,
      name: site.name,
      address: formatAddress(site),
      equipment: equipmentBySite.get(site.id) ?? [],
    });
    sitesByClient.set(site.client_id, sites);
  }
  return {
    clients: (clientsResult.data ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      sites: sitesByClient.get(client.id) ?? [],
    })),
    templates: (versionsResult.data ?? [])
      .filter((version) => availableTemplateIds.has(version.template_id))
      .map((version) => ({
        versionId: version.id,
        name: version.name,
        versionNumber: version.version_number,
      })),
    jobs: (jobsResult.data ?? []).flatMap((job) =>
      job.job_number
        ? [
            {
              id: job.id,
              jobNumber: job.job_number,
              title: job.title,
              clientId: job.client_id,
              siteId: job.site_id,
            },
          ]
        : [],
    ),
    followUpOwners: (membershipsResult.data ?? [])
      .map((member) => {
        const profile = profiles.get(member.user_id);
        return {
          userId: member.user_id,
          role: member.role as "admin" | "buero",
          name:
            [profile?.first_name, profile?.last_name]
              .filter(Boolean)
              .join(" ") ||
            profile?.email ||
            "Unbekannte Person",
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "de")),
    serviceCases: (serviceCasesResult.data ?? []).map((serviceCase) => ({
      id: serviceCase.id,
      caseNumber: serviceCase.case_number,
      summary: serviceCase.summary,
      clientId: serviceCase.client_id,
      siteId: serviceCase.site_id,
    })),
  };
}

export async function getMaintenanceWorkspace(): Promise<MaintenanceWorkspaceResult> {
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const throughDate = addLocalMonthsClamped(
    formatBerlinLocalDate(new Date()),
    18,
  );
  const workspaceResults = await Promise.all([
    context.admin
      .from("maintenance_plans")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false }),
    context.admin
      .from("maintenance_due_work")
      .select("*")
      .eq("organization_id", context.organizationId)
      .in("status", ["open", "visit_created"])
      .lte("due_date", throughDate)
      .order("due_date"),
    context.admin
      .from("maintenance_coverages")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false }),
    loadMaintenanceOptions(context.admin, context.organizationId),
  ]).catch((error: unknown) => {
    console.error(
      "Failed to load maintenance workspace options:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  });
  if (!workspaceResults) {
    return { success: false, error: "maintenance_load_failed" };
  }
  const [plansResult, dueResult, coveragesResult, options] = workspaceResults;
  if (plansResult.error || dueResult.error || coveragesResult.error) {
    return { success: false, error: "maintenance_load_failed" };
  }
  const planRows = plansResult.data ?? [];
  const currentRevisionIds = planRows.flatMap((plan) =>
    plan.current_revision_id ? [plan.current_revision_id] : [],
  );
  const [revisionsResult, equipmentLinksResult] = await Promise.all([
    currentRevisionIds.length > 0
      ? context.admin
          .from("maintenance_plan_revisions")
          .select("*")
          .eq("organization_id", context.organizationId)
          .in("id", currentRevisionIds)
      : Promise.resolve({ data: [], error: null }),
    currentRevisionIds.length > 0
      ? context.admin
          .from("maintenance_plan_revision_equipment")
          .select("maintenance_plan_revision_id, equipment_id")
          .eq("organization_id", context.organizationId)
          .in("maintenance_plan_revision_id", currentRevisionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (revisionsResult.error || equipmentLinksResult.error) {
    return { success: false, error: "maintenance_load_failed" };
  }

  const clientNames = new Map(
    options.clients.map((client) => [client.id, client.name]),
  );
  const sites = new Map(
    options.clients.flatMap((client) =>
      client.sites.map(
        (site) => [site.id, { ...site, clientId: client.id }] as const,
      ),
    ),
  );
  const equipment = new Map(
    options.clients.flatMap((client) =>
      client.sites.flatMap((site) =>
        site.equipment.map((item) => [item.id, item] as const),
      ),
    ),
  );
  const equipmentIdsByRevision = new Map<string, string[]>();
  for (const link of equipmentLinksResult.data ?? []) {
    const ids =
      equipmentIdsByRevision.get(link.maintenance_plan_revision_id) ?? [];
    ids.push(link.equipment_id);
    equipmentIdsByRevision.set(link.maintenance_plan_revision_id, ids);
  }
  const revisions = new Map(
    (revisionsResult.data ?? []).map((row) => [row.id, row]),
  );
  const templates = new Map(
    options.templates.map((template) => [template.versionId, template]),
  );
  const coveragesById = new Map(
    (coveragesResult.data ?? []).map((row) => [row.id, row]),
  );
  const jobs = new Map(options.jobs.map((job) => [job.id, job]));

  const planById = new Map(planRows.map((row) => [row.id, row]));
  const dueByPlan = new Map<string, NonNullable<typeof dueResult.data>>();
  for (const due of dueResult.data ?? []) {
    const items = dueByPlan.get(due.maintenance_plan_id) ?? [];
    items.push(due);
    dueByPlan.set(due.maintenance_plan_id, items);
  }
  const plans: MaintenancePlanItem[] = planRows.flatMap((plan) => {
    const revision = plan.current_revision_id
      ? revisions.get(plan.current_revision_id)
      : null;
    const site = sites.get(plan.site_id);
    if (!revision || !site) return [];
    const currentDue = dueByPlan.get(plan.id) ?? [];
    const openDue = currentDue.filter((due) =>
      ["open", "visit_created"].includes(due.status),
    );
    return [
      {
        id: plan.id,
        planNumber: plan.plan_number,
        clientId: plan.client_id,
        clientName: clientNames.get(plan.client_id) ?? "Unbekannter Kunde",
        siteId: plan.site_id,
        siteName: site.name,
        maintenanceCoverageId: plan.maintenance_coverage_id,
        coverageNumber: plan.maintenance_coverage_id
          ? (coveragesById.get(plan.maintenance_coverage_id)?.coverage_number ??
            null)
          : null,
        status: plan.status,
        version: plan.version,
        archivedAt: plan.archived_at,
        generationThroughDate: plan.generation_through_date,
        revisionId: revision.id,
        revisionNumber: revision.revision_number,
        templateVersionId: revision.template_version_id,
        templateName:
          templates.get(revision.template_version_id)?.name ?? "Arbeitsvorlage",
        effectiveFromDate: revision.effective_from_date,
        firstDueDate: revision.first_due_date,
        intervalMonths: revision.interval_months,
        dueWindowBeforeDays: revision.due_window_before_days,
        dueWindowAfterDays: revision.due_window_after_days,
        plannedDurationMinutes: revision.planned_duration_minutes,
        nextDueBasis: revision.next_due_basis,
        operationalInstructions: revision.operational_instructions,
        overlapReason: revision.overlap_reason,
        equipment: (equipmentIdsByRevision.get(revision.id) ?? []).flatMap(
          (id) => {
            const item = equipment.get(id);
            return item ? [item] : [];
          },
        ),
        openDueCount: openDue.length,
        nextDueDate: openDue[0]?.due_date ?? null,
      },
    ];
  });
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const dueWork: MaintenanceDueItem[] = (dueResult.data ?? []).flatMap(
    (due) => {
      const plan = plansById.get(due.maintenance_plan_id);
      const planRow = planById.get(due.maintenance_plan_id);
      if (!plan || !planRow) return [];
      const job = due.job_id ? jobs.get(due.job_id) : null;
      return [
        {
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
          jobNumber: job?.jobNumber ?? null,
          planningOccurrenceId: due.planning_occurrence_id,
          scopeOutcome: due.scope_outcome,
          completedOn: due.completed_on,
          exceptionReason: due.exception_reason,
          version: due.version,
          equipment: plan.equipment,
        },
      ];
    },
  );
  const coverages: MaintenanceCoverageItem[] = (coveragesResult.data ?? []).map(
    (coverage) => ({
      id: coverage.id,
      coverageNumber: coverage.coverage_number,
      clientId: coverage.client_id,
      clientName: clientNames.get(coverage.client_id) ?? "Unbekannter Kunde",
      siteId: coverage.site_id,
      siteName: sites.get(coverage.site_id)?.name ?? "Unbekannter Einsatzort",
      reference: coverage.reference,
      description: coverage.description,
      status: coverage.status,
      validFrom: coverage.valid_from,
      validUntil: coverage.valid_until,
      noticeDate: coverage.notice_date,
      renewalDate: coverage.renewal_date,
      reviewDueDate: coverage.review_due_date,
      operationalNote: coverage.operational_note,
      renewalSignal: renewalSignal(
        coverage.review_due_date,
        formatBerlinLocalDate(new Date()),
      ),
      version: coverage.version,
    }),
  );
  return {
    success: true,
    workspace: {
      plans,
      dueWork,
      coverages,
      currentActorId: context.actorId,
      ...options,
    },
  };
}

export async function createMaintenanceCoverage(
  input: MaintenanceCoverageInput,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceCoverageSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("create_maintenance_coverage", {
    p_organization_id: context.organizationId,
    p_maintenance_coverage_id: parsed.data.coverageId,
    p_payload: parsed.data as unknown as Json,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, "maintenance_coverage_create_failed"),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function createMaintenancePlan(
  input: MaintenancePlanInput,
): Promise<MaintenanceActionResult> {
  const parsed = maintenancePlanSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc("create_maintenance_plan", {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data.planId,
    p_revision_id: parsed.data.revisionId,
    p_payload: parsed.data as unknown as Json,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, "maintenance_plan_create_failed"),
    };
  }
  if (parsed.data.status === "active") {
    const throughDate = addLocalMonthsClamped(
      formatBerlinLocalDate(new Date()),
      18,
    );
    const generated = await context.admin.rpc("generate_maintenance_due_work", {
      p_organization_id: context.organizationId,
      p_maintenance_plan_id: parsed.data.planId,
      p_expected_version: data.version,
      p_through_date: throughDate,
      p_actor_id: context.actorId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (generated.error) {
      refreshMaintenancePaths();
      return {
        success: false,
        error: mutationError(generated.error, "maintenance_generation_failed"),
      };
    }
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function reviseMaintenancePlan(
  input: MaintenancePlanInput & { expectedVersion: number },
): Promise<MaintenanceActionResult> {
  const parsed = maintenancePlanSchema
    .extend({
      expectedVersion: maintenanceTransitionSchema.shape.expectedVersion,
    })
    .safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const payload = {
    templateVersionId: parsed.data.templateVersionId,
    effectiveFromDate: parsed.data.effectiveFromDate,
    firstDueDate: parsed.data.firstDueDate,
    intervalMonths: parsed.data.intervalMonths,
    dueWindowBeforeDays: parsed.data.dueWindowBeforeDays,
    dueWindowAfterDays: parsed.data.dueWindowAfterDays,
    plannedDurationMinutes: parsed.data.plannedDurationMinutes,
    nextDueBasis: parsed.data.nextDueBasis,
    operationalInstructions: parsed.data.operationalInstructions ?? null,
    overlapReason: parsed.data.overlapReason ?? null,
    equipmentIds: parsed.data.equipmentIds,
  };
  const { data, error } = await context.admin.rpc("revise_maintenance_plan", {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data.planId,
    p_revision_id: parsed.data.revisionId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: payload,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, "maintenance_plan_revision_failed"),
    };
  }
  if (data.status === "active") {
    const throughDate = addLocalMonthsClamped(
      formatBerlinLocalDate(new Date()),
      18,
    );
    const generated = await context.admin.rpc("generate_maintenance_due_work", {
      p_organization_id: context.organizationId,
      p_maintenance_plan_id: parsed.data.planId,
      p_expected_version: data.version,
      p_through_date: throughDate,
      p_actor_id: context.actorId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (generated.error) {
      refreshMaintenancePaths();
      return {
        success: false,
        error: mutationError(generated.error, "maintenance_generation_failed"),
      };
    }
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function transitionMaintenancePlan(
  input: unknown,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceTransitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "transition_maintenance_plan",
    {
      p_organization_id: context.organizationId,
      p_maintenance_plan_id: parsed.data.planId,
      p_expected_version: parsed.data.expectedVersion,
      p_to_status: parsed.data.toStatus,
      p_reason: parsed.data.reason,
      p_actor_id: context.actorId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data) {
    return {
      success: false,
      error: mutationError(error, "maintenance_transition_failed"),
    };
  }
  if (parsed.data.toStatus === "active") {
    const throughDate = addLocalMonthsClamped(
      formatBerlinLocalDate(new Date()),
      18,
    );
    const generated = await context.admin.rpc("generate_maintenance_due_work", {
      p_organization_id: context.organizationId,
      p_maintenance_plan_id: parsed.data.planId,
      p_expected_version: data.version,
      p_through_date: throughDate,
      p_actor_id: context.actorId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (generated.error) {
      refreshMaintenancePaths();
      return {
        success: false,
        error: mutationError(generated.error, "maintenance_generation_failed"),
      };
    }
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function setMaintenancePlanArchived(input: {
  planId: string;
  expectedVersion: number;
  archived: boolean;
  reason: string;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  if (
    !maintenanceTransitionSchema.shape.planId.safeParse(input.planId).success ||
    !maintenanceTransitionSchema.shape.expectedVersion.safeParse(
      input.expectedVersion,
    ).success ||
    !maintenanceTransitionSchema.shape.reason.safeParse(input.reason).success ||
    !maintenanceTransitionSchema.shape.idempotencyKey.safeParse(
      input.idempotencyKey,
    ).success
  ) {
    return { success: false, error: "invalid_input" };
  }
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("set_maintenance_plan_archived", {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: input.planId,
    p_expected_version: input.expectedVersion,
    p_archived: input.archived,
    p_reason: input.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, "maintenance_archive_failed"),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function linkMaintenanceDueToJob(
  input: unknown,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceVisitLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "invalid_input" };
  }
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("link_maintenance_due_visit", {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_ids: parsed.data.dueWorkIds,
    p_job_id: parsed.data.jobId,
    p_planning_occurrence_id: parsed.data.planningOccurrenceId ?? null,
    p_expected_versions: parsed.data.expectedVersions,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, "maintenance_visit_link_failed"),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function createMaintenanceVisit(input: {
  dueWorkIds: string[];
  expectedVersions: number[];
  reason: string;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult & { jobNumber?: string }> {
  const parsed = maintenanceVisitLinkSchema
    .omit({ jobId: true, planningOccurrenceId: true })
    .safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "invalid_input" };
  }
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { data: replayEvents, error: replayError } = await context.admin
    .from("maintenance_due_work_events")
    .select("maintenance_due_work_id, request_payload")
    .eq("organization_id", context.organizationId)
    .eq("idempotency_key", parsed.data.idempotencyKey)
    .like("request_operation", "due_visit_link:%");
  if (replayError) {
    return { success: false, error: "maintenance_visit_context_failed" };
  }
  if (replayEvents.length > 0) {
    const replayDueIds = new Set(
      replayEvents.map((event) => event.maintenance_due_work_id),
    );
    const replayJobIds = new Set(
      replayEvents.flatMap((event) => {
        const payload = event.request_payload as Record<string, unknown>;
        return typeof payload.jobId === "string" ? [payload.jobId] : [];
      }),
    );
    const replayMatches =
      replayDueIds.size === parsed.data.dueWorkIds.length &&
      parsed.data.dueWorkIds.every((dueWorkId) =>
        replayDueIds.has(dueWorkId),
      ) &&
      replayJobIds.size === 1;
    const replayJobId = [...replayJobIds][0];
    if (!replayMatches || !replayJobId) {
      return { success: false, error: "maintenance_idempotency_conflict" };
    }
    const { data: replayJob, error: replayJobError } = await context.admin
      .from("jobs")
      .select("job_number")
      .eq("organization_id", context.organizationId)
      .eq("id", replayJobId)
      .single();
    if (replayJobError || !replayJob.job_number) {
      return { success: false, error: "maintenance_visit_context_failed" };
    }
    refreshMaintenancePaths();
    return { success: true, jobNumber: replayJob.job_number };
  }
  const { data: dueRows, error: dueError } = await context.admin
    .from("maintenance_due_work")
    .select("id, maintenance_plan_id, maintenance_plan_revision_id, due_date")
    .eq("organization_id", context.organizationId)
    .in("id", parsed.data.dueWorkIds);
  if (dueError) {
    return { success: false, error: "maintenance_visit_context_failed" };
  }
  if (dueRows?.length !== parsed.data.dueWorkIds.length) {
    return { success: false, error: "maintenance_due_not_found" };
  }
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [
    ...new Set(dueRows.map((row) => row.maintenance_plan_revision_id)),
  ];
  const [plansResult, revisionsResult] = await Promise.all([
    context.admin
      .from("maintenance_plans")
      .select("id, plan_number, client_id, site_id")
      .eq("organization_id", context.organizationId)
      .in("id", planIds),
    context.admin
      .from("maintenance_plan_revisions")
      .select(
        "id, template_version_id, planned_duration_minutes, operational_instructions",
      )
      .eq("organization_id", context.organizationId)
      .in("id", revisionIds),
  ]);
  if (plansResult.error || revisionsResult.error) {
    return { success: false, error: "maintenance_visit_context_failed" };
  }
  const plans = plansResult.data;
  const revisions = revisionsResult.data;
  if (!plans?.length || !revisions?.length) {
    return { success: false, error: "maintenance_visit_context_failed" };
  }
  const clientIds = new Set(plans.map((plan) => plan.client_id));
  const siteIds = new Set(plans.map((plan) => plan.site_id));
  const templateIds = new Set(
    revisions.map((revision) => revision.template_version_id),
  );
  if (clientIds.size !== 1 || siteIds.size !== 1 || templateIds.size !== 1) {
    return { success: false, error: "maintenance_due_batch_incompatible" };
  }
  const firstPlan = plans[0];
  const firstRevision = revisions[0];
  const durationByRevisionId = new Map(
    revisions.map((revision) => [
      revision.id,
      revision.planned_duration_minutes,
    ]),
  );
  const estimatedDurationMinutes = dueRows.reduce(
    (total, due) =>
      total + (durationByRevisionId.get(due.maintenance_plan_revision_id) ?? 0),
    0,
  );
  if (
    dueRows.some(
      (due) => !durationByRevisionId.has(due.maintenance_plan_revision_id),
    )
  ) {
    return { success: false, error: "maintenance_visit_context_failed" };
  }
  if (estimatedDurationMinutes < 15 || estimatedDurationMinutes > 10_080) {
    return { success: false, error: "maintenance_due_batch_incompatible" };
  }
  const numberResult = await getNextJobNumber();
  if (!numberResult.success) return numberResult;
  const jobResult = await createJob({
    jobNumber: numberResult.jobNumber,
    title: `Wartung · ${plans.map((plan) => plan.plan_number).join(", ")}`,
    description: firstRevision.operational_instructions ?? undefined,
    clientId: firstPlan.client_id,
    siteId: firstPlan.site_id,
    estimatedDurationMinutes,
    templateVersionId: firstRevision.template_version_id,
    selectedUserIds: [],
  });
  if (!jobResult.success) return jobResult;
  const linkResult = await context.admin.rpc("link_maintenance_due_visit", {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_ids: parsed.data.dueWorkIds,
    p_job_id: jobResult.job.id,
    p_planning_occurrence_id: null,
    p_expected_versions: parsed.data.expectedVersions,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (linkResult.error) {
    const rollback = await context.admin
      .from("jobs")
      .delete()
      .eq("id", jobResult.job.id)
      .eq("organization_id", context.organizationId);
    if (rollback.error)
      console.error(
        "maintenance_visit_rollback_failed",
        rollback.error.message,
      );
    return {
      success: false,
      error: mutationError(linkResult.error, "maintenance_visit_create_failed"),
    };
  }
  refreshMaintenancePaths();
  return {
    success: true,
    jobNumber: jobResult.job.jobNumber ?? numberResult.jobNumber,
  };
}

export async function scheduleMaintenanceVisit(input: {
  dueWorkId: string;
  expectedVersion: number;
  jobId: string;
  startsAtLocal: string;
  durationMinutes: number;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  const parsed = maintenanceScheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const planningResult = await createPlanningEntry({
    entryKind: "job_visit",
    internalType: null,
    jobId: parsed.data.jobId,
    title: null,
    description: null,
    location: null,
    timeKind: "timed",
    startsAtLocal: parsed.data.startsAtLocal,
    durationMinutes: parsed.data.durationMinutes,
    durationDays: null,
    assignmentDrafts: [],
    teamIds: [],
    overrideReason: null,
    assessmentFingerprint: null,
    idempotencyKey: parsed.data.idempotencyKey,
    recurrence: null,
  });
  if (!planningResult.success) {
    return { success: false, error: planningResult.error };
  }
  if (!planningResult.occurrenceIds[0]) {
    return { success: false, error: "maintenance_schedule_failed" };
  }
  const { error } = await context.admin.rpc("set_maintenance_due_occurrence", {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_planning_occurrence_id: planningResult.occurrenceIds[0],
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const rollback = await context.admin
      .from("planning_occurrences")
      .delete()
      .eq("id", planningResult.occurrenceIds[0])
      .eq("organization_id", context.organizationId);
    if (rollback.error) {
      console.error(
        "maintenance_schedule_rollback_failed",
        rollback.error.message,
      );
    }
    return {
      success: false,
      error: mutationError(error, "maintenance_schedule_failed"),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function setMaintenanceDueException(
  input: unknown,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceExceptionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("set_maintenance_due_exception", {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_status: parsed.data.toStatus,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, "maintenance_exception_failed"),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function completeMaintenanceDueWork(
  input: unknown,
): Promise<MaintenanceActionResult> {
  const parsed = maintenanceCompletionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("complete_maintenance_due_work", {
    p_organization_id: context.organizationId,
    p_maintenance_due_work_id: parsed.data.dueWorkId,
    p_expected_version: parsed.data.expectedVersion,
    p_scope_outcome: parsed.data.scopeOutcome,
    p_completed_on: parsed.data.completedOn,
    p_work_artifact_revision_ids: parsed.data.workArtifactRevisionIds,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return {
      success: false,
      error: mutationError(error, "maintenance_completion_failed"),
    };
  refreshMaintenancePaths();
  return { success: true };
}

export async function linkMaintenanceServiceCase(input: {
  planId: string;
  dueWorkId: string;
  expectedDueVersion: number;
  serviceCaseId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<MaintenanceActionResult> {
  const parsed = maintenanceTransitionSchema.shape.planId.safeParse(
    input.planId,
  );
  const due = maintenanceTransitionSchema.shape.planId.safeParse(
    input.dueWorkId,
  );
  const serviceCase = maintenanceTransitionSchema.shape.planId.safeParse(
    input.serviceCaseId,
  );
  const expectedVersion =
    maintenanceTransitionSchema.shape.expectedVersion.safeParse(
      input.expectedDueVersion,
    );
  const reason = maintenanceTransitionSchema.shape.reason.safeParse(
    input.reason,
  );
  const idempotencyKey =
    maintenanceTransitionSchema.shape.idempotencyKey.safeParse(
      input.idempotencyKey,
    );
  if (
    !parsed.success ||
    !due.success ||
    !serviceCase.success ||
    !expectedVersion.success ||
    !reason.success ||
    !idempotencyKey.success
  ) {
    return { success: false, error: "invalid_input" };
  }
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("link_maintenance_service_case", {
    p_organization_id: context.organizationId,
    p_maintenance_plan_id: parsed.data,
    p_maintenance_due_work_id: due.data,
    p_service_case_id: serviceCase.data,
    p_expected_due_version: expectedVersion.data,
    p_reason: reason.data,
    p_actor_id: context.actorId,
    p_idempotency_key: idempotencyKey.data,
  });
  if (error) {
    return {
      success: false,
      error: mutationError(error, "maintenance_service_case_link_failed"),
    };
  }
  refreshMaintenancePaths();
  return { success: true };
}

export async function getMaintenanceEvidenceOptions(
  jobId: string,
): Promise<
  | { success: true; options: MaintenanceEvidenceOption[] }
  | { success: false; error: string }
> {
  const context = await requireMaintenanceManager();
  if ("success" in context) return context;
  const { data: artifacts, error } = await context.admin
    .from("work_artifacts")
    .select("current_revision_id")
    .eq("organization_id", context.organizationId)
    .eq("job_id", jobId)
    .is("voided_at", null);
  if (error)
    return { success: false, error: "maintenance_evidence_load_failed" };
  const revisionIds = (artifacts ?? []).flatMap((artifact) =>
    artifact.current_revision_id ? [artifact.current_revision_id] : [],
  );
  if (revisionIds.length === 0) return { success: true, options: [] };
  const { data: revisions, error: revisionError } = await context.admin
    .from("work_artifact_revisions")
    .select("id, title, revision_number")
    .eq("organization_id", context.organizationId)
    .in("id", revisionIds)
    .order("revision_number", { ascending: false });
  if (revisionError) {
    return { success: false, error: "maintenance_evidence_load_failed" };
  }
  return {
    success: true,
    options: (revisions ?? []).map((revision) => ({
      revisionId: revision.id,
      title: revision.title,
      revisionNumber: revision.revision_number,
    })),
  };
}

export async function getAssignedMaintenanceContextForJob(
  jobId: string,
): Promise<
  | { success: true; contexts: FieldMaintenanceContext[] }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await admin
      .from("job_assignments")
      .select("id")
      .eq("organization_id", auth.context.orgId)
      .eq("job_id", jobId)
      .eq("user_id", auth.context.userId)
      .maybeSingle();
    if (assignmentError) {
      return { success: false, error: "maintenance_context_load_failed" };
    }
    if (!assignment) return { success: false, error: "not_authorized" };
  }
  const { data: dueRows, error } = await admin
    .from("maintenance_due_work")
    .select("*")
    .eq("organization_id", auth.context.orgId)
    .eq("job_id", jobId)
    .in("status", ["visit_created", "completed"]);
  if (error)
    return { success: false, error: "maintenance_context_load_failed" };
  if (!dueRows?.length) return { success: true, contexts: [] };
  const planIds = [...new Set(dueRows.map((row) => row.maintenance_plan_id))];
  const revisionIds = [
    ...new Set(dueRows.map((row) => row.maintenance_plan_revision_id)),
  ];
  const [plansResult, revisionsResult, linksResult] = await Promise.all([
    admin
      .from("maintenance_plans")
      .select("id, plan_number")
      .eq("organization_id", auth.context.orgId)
      .in("id", planIds),
    admin
      .from("maintenance_plan_revisions")
      .select("id, template_version_id, operational_instructions")
      .eq("organization_id", auth.context.orgId)
      .in("id", revisionIds),
    admin
      .from("maintenance_plan_revision_equipment")
      .select("maintenance_plan_revision_id, equipment_id")
      .eq("organization_id", auth.context.orgId)
      .in("maintenance_plan_revision_id", revisionIds),
  ]);
  if (plansResult.error || revisionsResult.error || linksResult.error) {
    return { success: false, error: "maintenance_context_load_failed" };
  }
  const plans = plansResult.data;
  const revisions = revisionsResult.data;
  const links = linksResult.data;
  const templateIds = [
    ...new Set((revisions ?? []).map((row) => row.template_version_id)),
  ];
  const equipmentIds = [
    ...new Set((links ?? []).map((row) => row.equipment_id)),
  ];
  const [templatesResult, equipmentRowsResult] = await Promise.all([
    templateIds.length
      ? admin
          .from("work_template_versions")
          .select("id, name, version_number")
          .eq("organization_id", auth.context.orgId)
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    equipmentIds.length
      ? admin
          .from("installed_equipment")
          .select("id, equipment_number, name")
          .eq("organization_id", auth.context.orgId)
          .in("id", equipmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (templatesResult.error || equipmentRowsResult.error) {
    return { success: false, error: "maintenance_context_load_failed" };
  }
  const templates = templatesResult.data;
  const equipmentRows = equipmentRowsResult.data;
  const plansById = new Map((plans ?? []).map((row) => [row.id, row]));
  const revisionsById = new Map((revisions ?? []).map((row) => [row.id, row]));
  const templatesById = new Map((templates ?? []).map((row) => [row.id, row]));
  const equipmentById = new Map(
    (equipmentRows ?? []).map((row) => [
      row.id,
      { id: row.id, equipmentNumber: row.equipment_number, name: row.name },
    ]),
  );
  const equipmentIdsByRevision = new Map<string, string[]>();
  for (const link of links ?? []) {
    const ids =
      equipmentIdsByRevision.get(link.maintenance_plan_revision_id) ?? [];
    ids.push(link.equipment_id);
    equipmentIdsByRevision.set(link.maintenance_plan_revision_id, ids);
  }
  return {
    success: true,
    contexts: dueRows.flatMap((due) => {
      const plan = plansById.get(due.maintenance_plan_id);
      const revision = revisionsById.get(due.maintenance_plan_revision_id);
      const template = revision
        ? templatesById.get(revision.template_version_id)
        : null;
      if (!plan || !revision || !template) return [];
      return [
        {
          planNumber: plan.plan_number,
          dueDate: due.due_date,
          windowStartDate: due.window_start_date,
          windowEndDate: due.window_end_date,
          templateName: template.name,
          templateVersionNumber: template.version_number,
          operationalInstructions: revision.operational_instructions,
          equipment: (equipmentIdsByRevision.get(revision.id) ?? []).flatMap(
            (id) => {
              const item = equipmentById.get(id);
              return item ? [item] : [];
            },
          ),
        },
      ];
    }),
  };
}
