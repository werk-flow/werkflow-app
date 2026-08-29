"use server";

import { revalidatePath, updateTag } from "next/cache";

import { CACHE_TAGS } from "@/lib/data/cached";
import { authenticateAndAuthorize } from "@/lib/jobs/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  equipmentArchiveSchema,
  equipmentCreateSchema,
  equipmentCorrectionSchema,
  equipmentTransitionSchema,
  equipmentUpdateSchema,
  equipmentReplacementSchema,
  equipmentSourceSchema,
  equipmentWorkLinkSchema,
} from "./validation";
import type {
  EquipmentArchiveInput,
  EquipmentClientOption,
  EquipmentCreateInput,
  EquipmentCorrectionInput,
  EquipmentDetail,
  EquipmentDetailResult,
  EquipmentEvent,
  EquipmentEventLink,
  EquipmentFieldProjection,
  EquipmentIdentifier,
  EquipmentListItem,
  EquipmentListResult,
  EquipmentMutationResult,
  EquipmentReplacementInput,
  EquipmentSourceInput,
  EquipmentSourceOption,
  EquipmentRow,
  EquipmentTransitionInput,
  EquipmentUpdateInput,
  EquipmentWorkLink,
  EquipmentWorkLinkInput,
} from "./types";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ManagerContext = {
  organizationId: string;
  userId: string;
  admin: AdminClient;
};
type Failure = { success: false; error: string };

const EQUIPMENT_ERROR_CODES = [
  "installed_equipment_not_authorized",
  "installed_equipment_not_found",
  "installed_equipment_site_invalid",
  "installed_equipment_parent_invalid",
  "installed_equipment_predecessor_invalid",
  "installed_equipment_classification_invalid",
  "installed_equipment_subtype_category_mismatch",
  "installed_equipment_identifier_type_invalid",
  "installed_equipment_identifier_value_required",
  "installed_equipment_identifiers_invalid",
  "installed_equipment_stale_version",
  "installed_equipment_reason_required",
  "installed_equipment_transition_not_allowed",
  "installed_equipment_use_replace_action",
  "installed_equipment_archived",
  "installed_equipment_voided",
  "installed_equipment_replace_not_allowed",
  "installed_equipment_successor_state_invalid",
  "installed_equipment_archive_not_allowed",
  "installed_equipment_archive_state_unchanged",
  "installed_equipment_idempotency_conflict",
  "installed_equipment_correction_target_invalid",
  "installed_equipment_successor_not_found",
  "installed_equipment_successor_origin_invalid",
  "installed_equipment_work_target_invalid",
  "installed_equipment_job_target_invalid",
  "installed_equipment_project_target_invalid",
  "installed_equipment_initial_state_invalid",
  "installed_equipment_source_target_invalid",
  "installed_equipment_replacement_cycle",
  "installed_equipment_document_version_invalid",
  "installed_equipment_document_link_not_found",
] as const;

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function mapEquipmentError(
  error: { message?: string; code?: string } | null,
): string {
  if (error?.code === "23505")
    return "installed_equipment_duplicate_identifier";
  return (
    EQUIPMENT_ERROR_CODES.find((code) => error?.message?.includes(code)) ??
    "installed_equipment_action_failed"
  );
}

async function requireEquipmentManager(): Promise<ManagerContext | Failure> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove)
    return { success: false, error: "not_authorized" };
  return {
    organizationId: auth.context.orgId,
    userId: auth.context.userId,
    admin: createSupabaseAdminClient(),
  };
}

function revalidateEquipment(organizationId: string): void {
  updateTag(CACHE_TAGS.clients(organizationId));
  updateTag(CACHE_TAGS.jobs(organizationId));
  updateTag(CACHE_TAGS.projects(organizationId));
  updateTag(CACHE_TAGS.documents(organizationId));
  updateTag(CACHE_TAGS.equipment(organizationId));
  revalidatePath("/service", "layout");
  revalidatePath("/kunden", "layout");
  revalidatePath("/auftraege", "layout");
  revalidatePath("/dokumente", "layout");
}

function formatSiteAddress(site: {
  street: string | null;
  postal_code: string | null;
  city: string | null;
}): string {
  const locality = [site.postal_code, site.city].filter(Boolean).join(" ");
  return (
    [site.street, locality].filter(Boolean).join(", ") ||
    "Adresse nicht erfasst"
  );
}

function toIdentifier(
  row: Database["public"]["Tables"]["installed_equipment_identifiers"]["Row"],
): EquipmentIdentifier {
  return {
    id: row.id,
    identifierType: row.identifier_type,
    value: row.value,
    issuer: row.issuer,
  };
}

function toListItem(args: {
  row: EquipmentRow;
  clientName: string;
  site: {
    name: string;
    street: string | null;
    postal_code: string | null;
    city: string | null;
  };
  identifiers: EquipmentIdentifier[];
}): EquipmentListItem {
  return {
    id: args.row.id,
    equipmentNumber: args.row.equipment_number,
    name: args.row.name,
    category: args.row.category,
    subtype: args.row.subtype,
    state: args.row.state,
    manufacturer: args.row.manufacturer,
    model: args.row.model,
    locationDetail: args.row.location_detail,
    clientId: args.row.client_id,
    clientName: args.clientName,
    siteId: args.row.site_id,
    siteName: args.site.name,
    siteAddress: formatSiteAddress(args.site),
    parentEquipmentId: args.row.parent_equipment_id,
    archivedAt: args.row.archived_at,
    voidedAt: args.row.voided_at,
    identifiers: args.identifiers,
    version: args.row.version,
  };
}

async function loadListItems(
  admin: AdminClient,
  organizationId: string,
  rows: EquipmentRow[],
): Promise<EquipmentListItem[]> {
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((row) => row.client_id))];
  const siteIds = [...new Set(rows.map((row) => row.site_id))];
  const equipmentIds = rows.map((row) => row.id);
  const [clientsResult, sitesResult, identifiersResult] = await Promise.all([
    admin
      .from("clients")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", clientIds),
    admin
      .from("client_sites")
      .select("id, name, street, postal_code, city")
      .eq("organization_id", organizationId)
      .in("id", siteIds),
    admin
      .from("installed_equipment_identifiers")
      .select("*")
      .eq("organization_id", organizationId)
      .in("equipment_id", equipmentIds)
      .order("created_at"),
  ]);
  if (clientsResult.error || sitesResult.error || identifiersResult.error) {
    throw new Error("installed_equipment_list_hydration_failed");
  }
  const clientsById = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client.name]),
  );
  const sitesById = new Map(
    (sitesResult.data ?? []).map((site) => [site.id, site]),
  );
  const identifiersByEquipment = new Map<string, EquipmentIdentifier[]>();
  for (const row of identifiersResult.data ?? []) {
    const identifiers = identifiersByEquipment.get(row.equipment_id) ?? [];
    identifiers.push(toIdentifier(row));
    identifiersByEquipment.set(row.equipment_id, identifiers);
  }
  return rows.flatMap((row) => {
    const site = sitesById.get(row.site_id);
    const clientName = clientsById.get(row.client_id);
    if (!site || !clientName) {
      console.error("Installed equipment hydration dropped a row:", {
        equipmentId: row.id,
        missingClientId: clientName ? null : row.client_id,
        missingSiteId: site ? null : row.site_id,
      });
      return [];
    }
    return [
      toListItem({
        row,
        clientName,
        site,
        identifiers: identifiersByEquipment.get(row.id) ?? [],
      }),
    ];
  });
}

async function loadClientOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<EquipmentClientOption[]> {
  const [clientsResult, sitesResult] = await Promise.all([
    admin
      .from("clients")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("client_sites")
      .select("id, client_id, name, street, postal_code, city, is_active")
      .eq("organization_id", organizationId)
      .order("name"),
  ]);
  if (clientsResult.error || sitesResult.error) return [];
  return (clientsResult.data ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    sites: (sitesResult.data ?? [])
      .filter((site) => site.client_id === client.id)
      .map((site) => ({
        id: site.id,
        name: site.name,
        address: formatSiteAddress(site),
        isActive: site.is_active,
      })),
  }));
}

export async function getInstalledEquipmentList(): Promise<EquipmentListResult> {
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin
    .from("installed_equipment")
    .select("*")
    .eq("organization_id", context.organizationId)
    .is("voided_at", null)
    .order("equipment_number");
  if (error) {
    console.error("Failed to load installed equipment list:", {
      code: error.code,
    });
    return { success: false, error: "installed_equipment_load_failed" };
  }
  try {
    const [equipment, clients] = await Promise.all([
      loadListItems(context.admin, context.organizationId, data ?? []),
      loadClientOptions(context.admin, context.organizationId),
    ]);
    return { success: true, equipment, clients };
  } catch {
    return { success: false, error: "installed_equipment_load_failed" };
  }
}

async function hydrateEventLinks(
  admin: AdminClient,
  organizationId: string,
  rows: Database["public"]["Tables"]["installed_equipment_event_links"]["Row"][],
): Promise<Map<string, EquipmentEventLink[]>> {
  const jobIds = rows.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const projectIds = rows.flatMap((row) =>
    row.project_id ? [row.project_id] : [],
  );
  const documentIds = rows.flatMap((row) =>
    row.document_id ? [row.document_id] : [],
  );
  const [jobsResult, projectsResult, documentsResult] = await Promise.all([
    jobIds.length
      ? admin
          .from("jobs")
          .select("id, job_number, title")
          .eq("organization_id", organizationId)
          .in("id", jobIds)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? admin
          .from("projects")
          .select("id, project_number, name")
          .eq("organization_id", organizationId)
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
    documentIds.length
      ? admin
          .from("documents")
          .select("id, display_name")
          .eq("organization_id", organizationId)
          .in("id", documentIds)
      : Promise.resolve({ data: [] }),
  ]);
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const projects = new Map(
    (projectsResult.data ?? []).map((project) => [project.id, project]),
  );
  const documents = new Map(
    (documentsResult.data ?? []).map((document) => [document.id, document]),
  );
  const result = new Map<string, EquipmentEventLink[]>();
  for (const row of rows) {
    const job = row.job_id ? jobs.get(row.job_id) : null;
    const project = row.project_id ? projects.get(row.project_id) : null;
    const document = row.document_id ? documents.get(row.document_id) : null;
    const link: EquipmentEventLink = {
      id: row.id,
      jobId: row.job_id,
      projectId: row.project_id,
      workArtifactRevisionId: row.work_artifact_revision_id,
      workHandoverReleaseId: row.work_handover_release_id,
      documentId: row.document_id,
      documentVersionNumber: row.document_version_number,
      label: job
        ? `Auftrag ${job.job_number ?? job.title}`
        : project
          ? `Projekt ${project.project_number ?? project.name}`
          : document
            ? `${document.display_name}, Version ${row.document_version_number}`
            : row.work_artifact_revision_id
              ? "Exakte Arbeitsnachweis-Revision"
              : "Exakter Übergabestand",
      href: job
        ? `/auftraege/${encodeURIComponent(job.job_number ?? job.id)}`
        : project
          ? `/auftraege/projekt/${encodeURIComponent(project.project_number ?? project.id)}`
          : document
            ? `/dokumente?document=${encodeURIComponent(document.id)}`
            : null,
    };
    const links = result.get(row.event_id) ?? [];
    links.push(link);
    result.set(row.event_id, links);
  }
  return result;
}

export async function getInstalledEquipmentDetailByNumber(
  equipmentNumber: string,
): Promise<EquipmentDetailResult> {
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data: row, error } = await context.admin
    .from("installed_equipment")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("equipment_number", equipmentNumber.trim().toUpperCase())
    .maybeSingle();
  if (error || !row)
    return { success: false, error: "installed_equipment_not_found" };

  const [relatedRowsResult, eventsResult, workLinksResult] = await Promise.all([
    context.admin
      .from("installed_equipment")
      .select("*")
      .eq("organization_id", context.organizationId)
      .or(
        `id.eq.${row.parent_equipment_id ?? row.id},parent_equipment_id.eq.${row.id},id.eq.${row.predecessor_equipment_id ?? row.id},predecessor_equipment_id.eq.${row.id}`,
      ),
    context.admin
      .from("installed_equipment_events")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("equipment_id", row.id)
      .order("effective_at", { ascending: false })
      .order("recorded_at", { ascending: false }),
    context.admin
      .from("installed_equipment_work_links")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("equipment_id", row.id),
  ]);
  if (relatedRowsResult.error || eventsResult.error || workLinksResult.error) {
    return { success: false, error: "installed_equipment_load_failed" };
  }
  const eventIds = (eventsResult.data ?? []).map((event) => event.id);
  const eventLinksResult = eventIds.length
    ? await context.admin
        .from("installed_equipment_event_links")
        .select("*")
        .eq("organization_id", context.organizationId)
        .in("event_id", eventIds)
    : { data: [], error: null };
  if (eventLinksResult.error) {
    return { success: false, error: "installed_equipment_load_failed" };
  }
  const allRows = [
    row,
    ...(relatedRowsResult.data ?? []).filter(
      (related) => related.id !== row.id,
    ),
  ];
  let items: EquipmentListItem[];
  try {
    items = await loadListItems(context.admin, context.organizationId, allRows);
  } catch {
    return { success: false, error: "installed_equipment_load_failed" };
  }
  const current = items.find((item) => item.id === row.id);
  if (!current)
    return { success: false, error: "installed_equipment_load_failed" };

  const actorIds = [
    ...new Set((eventsResult.data ?? []).map((event) => event.actor_id)),
  ];
  const { data: actors } = actorIds.length
    ? await context.admin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", actorIds)
    : { data: [] };
  const actorNames = new Map(
    (actors ?? []).map((actor) => [
      actor.id,
      [actor.first_name, actor.last_name].filter(Boolean).join(" ") ||
        actor.email ||
        "Unbekannt",
    ]),
  );
  const eventLinks = await hydrateEventLinks(
    context.admin,
    context.organizationId,
    eventLinksResult.data ?? [],
  );
  const events: EquipmentEvent[] = (eventsResult.data ?? []).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    fromState: event.from_state,
    toState: event.to_state,
    effectiveAt: event.effective_at,
    recordedAt: event.recorded_at,
    actorName: actorNames.get(event.actor_id) ?? "Unbekannt",
    reason: event.reason,
    correctsEventId: event.corrects_event_id,
    siteSnapshot: event.site_snapshot,
    beforeSnapshot: event.before_snapshot,
    afterSnapshot: event.after_snapshot,
    links: eventLinks.get(event.id) ?? [],
  }));

  const workRows = workLinksResult.data ?? [];
  const jobIds = workRows.flatMap((link) => (link.job_id ? [link.job_id] : []));
  const projectIds = workRows.flatMap((link) =>
    link.project_id ? [link.project_id] : [],
  );
  const [jobsResult, projectsResult] = await Promise.all([
    jobIds.length
      ? context.admin
          .from("jobs")
          .select("id, job_number, title")
          .in("id", jobIds)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? context.admin
          .from("projects")
          .select("id, project_number, name")
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const projects = new Map(
    (projectsResult.data ?? []).map((project) => [project.id, project]),
  );
  const workLinks: EquipmentWorkLink[] = workRows.flatMap((link) => {
    const job = link.job_id ? jobs.get(link.job_id) : null;
    const project = link.project_id ? projects.get(link.project_id) : null;
    if (job)
      return [
        {
          id: link.id,
          jobId: job.id,
          projectId: null,
          label: `Auftrag ${job.job_number ?? job.title}`,
          href: `/auftraege/${encodeURIComponent(job.job_number ?? job.id)}`,
        },
      ];
    if (project)
      return [
        {
          id: link.id,
          jobId: null,
          projectId: project.id,
          label: `Projekt ${project.project_number ?? project.name}`,
          href: `/auftraege/projekt/${encodeURIComponent(project.project_number ?? project.id)}`,
        },
      ];
    return [];
  });

  const detail: EquipmentDetail = {
    ...current,
    technicalNotes: row.technical_notes,
    installationDate: row.installation_date,
    commissioningDate: row.commissioning_date,
    warrantyProvider: row.warranty_provider,
    warrantyBasis: row.warranty_basis,
    warrantyStartDate: row.warranty_start_date,
    warrantyEndDate: row.warranty_end_date,
    parent: items.find((item) => item.id === row.parent_equipment_id) ?? null,
    predecessor:
      items.find((item) => item.id === row.predecessor_equipment_id) ?? null,
    successor:
      items.find(
        (item) =>
          item.voidedAt === null &&
          item.parentEquipmentId !== row.id &&
          allRows.find((related) => related.id === item.id)
            ?.predecessor_equipment_id === row.id,
      ) ?? null,
    components: items.filter((item) => item.parentEquipmentId === row.id),
    events,
    workLinks,
  };
  return { success: true, equipment: detail };
}

export async function getInstalledEquipmentForClient(
  clientId: string,
): Promise<{ success: true; equipment: EquipmentListItem[] } | Failure> {
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin
    .from("installed_equipment")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("client_id", clientId)
    .is("voided_at", null)
    .order("equipment_number");
  if (error)
    return { success: false, error: "installed_equipment_load_failed" };
  try {
    return {
      success: true,
      equipment: await loadListItems(
        context.admin,
        context.organizationId,
        data ?? [],
      ),
    };
  } catch {
    return { success: false, error: "installed_equipment_load_failed" };
  }
}

export async function getAssignedEquipmentForJob(
  jobId: string,
): Promise<{ success: true; equipment: EquipmentFieldProjection[] } | Failure> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("organization_id", auth.context.orgId)
    .maybeSingle();
  if (!job) return { success: false, error: "not_authorized" };
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment } = await admin
      .from("job_assignments")
      .select("id")
      .eq("job_id", jobId)
      .eq("user_id", auth.context.userId)
      .maybeSingle();
    if (!assignment) return { success: false, error: "not_authorized" };
  }
  const { data: links, error: linksError } = await admin
    .from("installed_equipment_work_links")
    .select("equipment_id")
    .eq("organization_id", auth.context.orgId)
    .eq("job_id", jobId);
  if (linksError) {
    return { success: false, error: "installed_equipment_load_failed" };
  }
  const ids = (links ?? []).map((link) => link.equipment_id);
  if (!ids.length) return { success: true, equipment: [] };
  const { data, error } = await admin
    .from("installed_equipment")
    .select(
      "id, equipment_number, name, category, subtype, state, manufacturer, model, location_detail",
    )
    .eq("organization_id", auth.context.orgId)
    .is("voided_at", null)
    .in("id", ids);
  if (error) {
    return { success: false, error: "installed_equipment_load_failed" };
  }
  return {
    success: true,
    equipment: (data ?? []).map((row) => ({
      id: row.id,
      equipmentNumber: row.equipment_number,
      name: row.name,
      category: row.category,
      subtype: row.subtype,
      state: row.state,
      manufacturer: row.manufacturer,
      model: row.model,
      locationDetail: row.location_detail,
    })),
  };
}

export async function getInstalledEquipmentSourceOptions(
  equipmentId: string,
): Promise<
  | { success: true; options: EquipmentSourceOption[] }
  | { success: false; error: string }
> {
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data: equipment } = await context.admin
    .from("installed_equipment")
    .select("id, client_id, site_id")
    .eq("id", equipmentId)
    .eq("organization_id", context.organizationId)
    .is("voided_at", null)
    .maybeSingle();
  if (!equipment)
    return { success: false, error: "installed_equipment_not_found" };

  const [jobsResult, projectsResult, documentLinksResult] = await Promise.all([
    context.admin
      .from("jobs")
      .select("id, job_number, title")
      .eq("organization_id", context.organizationId)
      .eq("client_id", equipment.client_id)
      .or(`site_id.is.null,site_id.eq.${equipment.site_id}`),
    context.admin
      .from("projects")
      .select("id, project_number, name")
      .eq("organization_id", context.organizationId)
      .eq("client_id", equipment.client_id)
      .or(`site_id.is.null,site_id.eq.${equipment.site_id}`),
    context.admin
      .from("document_links")
      .select("document_id")
      .eq("organization_id", context.organizationId)
      .eq("equipment_id", equipmentId),
  ]);
  if (jobsResult.error || projectsResult.error || documentLinksResult.error) {
    return { success: false, error: "installed_equipment_source_load_failed" };
  }
  const jobs = jobsResult.data ?? [];
  const projects = projectsResult.data ?? [];
  const jobIds = jobs.map((job) => job.id);
  const projectIds = projects.map((project) => project.id);
  const targetClause = [
    jobIds.length ? `job_id.in.(${jobIds.join(",")})` : null,
    projectIds.length ? `project_id.in.(${projectIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");

  const [artifactRootsResult, packagesResult, documentsResult] =
    await Promise.all([
      targetClause
        ? context.admin
            .from("work_artifacts")
            .select("id")
            .eq("organization_id", context.organizationId)
            .or(targetClause)
        : Promise.resolve({ data: [], error: null }),
      targetClause
        ? context.admin
            .from("work_handover_packages")
            .select("id, job_id, project_id")
            .eq("organization_id", context.organizationId)
            .or(targetClause)
        : Promise.resolve({ data: [], error: null }),
      documentLinksResult.data?.length
        ? context.admin
            .from("documents")
            .select("id, display_name, current_version_number")
            .eq("organization_id", context.organizationId)
            .in(
              "id",
              documentLinksResult.data.map((link) => link.document_id),
            )
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (
    artifactRootsResult.error ||
    packagesResult.error ||
    documentsResult.error
  ) {
    return { success: false, error: "installed_equipment_source_load_failed" };
  }
  const artifactIds = (artifactRootsResult.data ?? []).map(
    (artifact) => artifact.id,
  );
  const packageIds = (packagesResult.data ?? []).map((item) => item.id);
  const [revisionsResult, releasesResult] = await Promise.all([
    artifactIds.length
      ? context.admin
          .from("work_artifact_revisions")
          .select("id, artifact_id, revision_number, title")
          .eq("organization_id", context.organizationId)
          .in("artifact_id", artifactIds)
      : Promise.resolve({ data: [], error: null }),
    packageIds.length
      ? context.admin
          .from("work_handover_releases")
          .select("id, package_id, release_number")
          .eq("organization_id", context.organizationId)
          .in("package_id", packageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (revisionsResult.error || releasesResult.error) {
    return { success: false, error: "installed_equipment_source_load_failed" };
  }
  const jobLabels = new Map(
    jobs.map((job) => [job.id, job.job_number ?? job.title]),
  );
  const projectLabels = new Map(
    projects.map((project) => [
      project.id,
      project.project_number ?? project.name,
    ]),
  );
  const packageLabels = new Map(
    (packagesResult.data ?? []).map((item) => [
      item.id,
      item.job_id
        ? `Auftrag ${jobLabels.get(item.job_id) ?? ""}`
        : `Projekt ${projectLabels.get(item.project_id ?? "") ?? ""}`,
    ]),
  );
  return {
    success: true,
    options: [
      ...jobs.map((job) => ({
        value: `job:${job.id}`,
        targetType: "job" as const,
        targetId: job.id,
        label: `Auftrag ${job.job_number ?? job.title}`,
        description: job.title,
      })),
      ...projects.map((project) => ({
        value: `project:${project.id}`,
        targetType: "project" as const,
        targetId: project.id,
        label: `Projekt ${project.project_number ?? project.name}`,
        description: project.name,
      })),
      ...(revisionsResult.data ?? []).map((revision) => ({
        value: `artifact_revision:${revision.id}`,
        targetType: "artifact_revision" as const,
        targetId: revision.id,
        label: `${revision.title}, Revision ${revision.revision_number}`,
        description: "Exakte Arbeitsnachweis-Revision",
      })),
      ...(releasesResult.data ?? []).map((release) => ({
        value: `handover_release:${release.id}`,
        targetType: "handover_release" as const,
        targetId: release.id,
        label: `${packageLabels.get(release.package_id) ?? "Übergabe"}, Freigabe ${release.release_number}`,
        description: "Exakter unveränderlicher Übergabestand",
      })),
      ...(documentsResult.data ?? []).map((document) => ({
        value: `document:${document.id}:${document.current_version_number}`,
        targetType: "document" as const,
        targetId: document.id,
        label: `${document.display_name}, Version ${document.current_version_number}`,
        description: "Exakte Dokumentversion",
        documentVersionNumber: document.current_version_number,
      })),
    ],
  };
}

export async function createInstalledEquipment(
  input: EquipmentCreateInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentCreateSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "create_installed_equipment",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_payload: toJson(parsed.data),
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function updateInstalledEquipment(
  input: EquipmentUpdateInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentUpdateSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "update_installed_equipment_details",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_payload: toJson(parsed.data),
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function transitionInstalledEquipment(
  input: EquipmentTransitionInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentTransitionSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "transition_installed_equipment",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_to_state: parsed.data.toState,
      p_effective_at: parsed.data.effectiveAt,
      p_reason: parsed.data.reason,
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function setInstalledEquipmentArchived(
  input: EquipmentArchiveInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentArchiveSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "set_installed_equipment_archived",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_archived: parsed.data.archived,
      p_reason: parsed.data.reason,
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function replaceInstalledEquipment(
  input: EquipmentReplacementInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentReplacementSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "replace_installed_equipment",
    {
      p_organization_id: context.organizationId,
      p_predecessor_id: parsed.data.predecessorId,
      p_successor_id: parsed.data.successorId,
      p_expected_version: parsed.data.expectedVersion,
      p_successor_payload: toJson(parsed.data),
      p_effective_at: parsed.data.effectiveAt,
      p_reason: parsed.data.reason,
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function correctInstalledEquipmentTerminalAction(
  input: EquipmentCorrectionInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentCorrectionSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "correct_installed_equipment_terminal_action",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_corrects_event_id: parsed.data.correctsEventId,
      p_effective_at: parsed.data.effectiveAt,
      p_reason: parsed.data.reason,
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function setInstalledEquipmentWorkLink(
  input: EquipmentWorkLinkInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentWorkLinkSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc(
    "set_installed_equipment_work_link",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_job_id: parsed.data.jobId ?? null,
      p_project_id: parsed.data.projectId ?? null,
      p_linked: parsed.data.linked,
      p_reason: parsed.data.reason ?? "",
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}

export async function linkInstalledEquipmentSource(
  input: EquipmentSourceInput,
): Promise<EquipmentMutationResult> {
  const parsed = equipmentSourceSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, error: "installed_equipment_input_invalid" };
  const context = await requireEquipmentManager();
  if ("success" in context) return context;
  let documentStoragePath: string | null = null;
  if (parsed.data.targetType === "document") {
    const versionNumber = parsed.data.documentVersionNumber;
    const { data: document, error: documentError } = await context.admin
      .from("documents")
      .select("current_version_number, storage_path, deleted_at")
      .eq("id", parsed.data.targetId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (documentError || !document || document.deleted_at) {
      return {
        success: false,
        error: "installed_equipment_source_target_invalid",
      };
    }
    if (document.current_version_number === versionNumber) {
      documentStoragePath = document.storage_path;
    } else {
      const { data: version, error: versionError } = await context.admin
        .from("document_versions")
        .select("storage_path")
        .eq("document_id", parsed.data.targetId)
        .eq("organization_id", context.organizationId)
        .eq("version_number", versionNumber)
        .maybeSingle();
      if (versionError || !version) {
        return {
          success: false,
          error: "installed_equipment_document_version_invalid",
        };
      }
      documentStoragePath = version.storage_path;
    }
  }
  const { data, error } = await context.admin.rpc(
    "link_installed_equipment_source",
    {
      p_organization_id: context.organizationId,
      p_equipment_id: parsed.data.equipmentId,
      p_expected_version: parsed.data.expectedVersion,
      p_source: toJson({
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        documentVersionNumber: parsed.data.documentVersionNumber,
        documentStoragePath,
      }),
      p_reason: parsed.data.reason,
      p_actor_id: context.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error || !data)
    return { success: false, error: mapEquipmentError(error) };
  revalidateEquipment(context.organizationId);
  return { success: true, equipment: data };
}
