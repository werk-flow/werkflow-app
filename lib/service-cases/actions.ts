"use server";

import { revalidatePath } from "next/cache";

import { authenticateAndAuthorize } from "@/lib/jobs/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import {
  serviceCaseCreateSchema,
  serviceCaseEvidenceSchema,
  serviceCaseRelationSchema,
  serviceCaseUpdateSchema,
} from "./validation";
import type {
  FieldServiceContext,
  FieldServiceContextResult,
  ServiceCaseClientOption,
  ServiceCaseCreateInput,
  ServiceCaseDetail,
  ServiceCaseDetailResult,
  ServiceCaseDetailWorkspace,
  ServiceCaseDocument,
  ServiceCaseEquipment,
  ServiceCaseEvidenceInput,
  ServiceCaseEvidenceOption,
  ServiceCaseEvent,
  ServiceCaseJobOption,
  ServiceCaseListItem,
  ServiceCaseListResult,
  ServiceCaseMutationResult,
  ServiceCaseRelation,
  ServiceCaseRelationInput,
  ServiceCaseRow,
  ServiceCaseUpdateInput,
} from "./types";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ManagerContext = {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
};

async function requireServiceManager(): Promise<
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
    "service_case_not_authorized",
    "service_case_idempotency_conflict",
    "service_case_request_not_found",
    "service_case_request_mismatch",
    "service_case_request_already_converted",
    "service_case_request_customer_site_required",
    "service_case_direct_input_required",
    "service_case_client_mismatch",
    "service_case_site_mismatch",
    "service_case_contact_mismatch",
    "service_case_job_mismatch",
    "service_case_equipment_mismatch",
    "service_case_reason_required",
    "service_case_not_found",
    "service_case_stale_version",
    "service_case_resolution_note_required",
    "service_case_duplicate_relation_required",
    "service_case_relation_mismatch",
    "service_case_relation_cycle",
    "service_case_related_not_found",
    "service_case_evidence_mismatch",
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

async function loadClientOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<ServiceCaseClientOption[]> {
  const [clientsResult, sitesResult, contactsResult, equipmentResult] = await Promise.all([
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
    admin
      .from("client_contacts")
      .select("id, client_id, name")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("installed_equipment")
      .select("id, site_id, equipment_number, name, manufacturer, model, location_detail")
      .eq("organization_id", organizationId)
      .is("voided_at", null)
      .is("archived_at", null)
      .order("equipment_number"),
  ]);
  if (
    clientsResult.error ||
    sitesResult.error ||
    contactsResult.error ||
    equipmentResult.error
  ) {
    throw new Error("service_case_client_options_failed");
  }
  const sitesByClient = new Map<
    string,
    NonNullable<typeof sitesResult.data>[number][]
  >();
  for (const site of sitesResult.data ?? []) {
    const sites = sitesByClient.get(site.client_id) ?? [];
    sites.push(site);
    sitesByClient.set(site.client_id, sites);
  }
  const equipmentBySite = new Map<
    string,
    NonNullable<typeof equipmentResult.data>[number][]
  >();
  for (const equipment of equipmentResult.data ?? []) {
    const items = equipmentBySite.get(equipment.site_id) ?? [];
    items.push(equipment);
    equipmentBySite.set(equipment.site_id, items);
  }
  const contactsByClient = new Map<
    string,
    NonNullable<typeof contactsResult.data>[number][]
  >();
  for (const contact of contactsResult.data ?? []) {
    const contacts = contactsByClient.get(contact.client_id) ?? [];
    contacts.push(contact);
    contactsByClient.set(contact.client_id, contacts);
  }
  return (clientsResult.data ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    sites: (sitesByClient.get(client.id) ?? []).map((site) => ({
        id: site.id,
        name: site.name,
        address: formatAddress(site),
        isActive: site.is_active,
        equipment: (equipmentBySite.get(site.id) ?? []).map((item) => ({
            id: item.id,
            equipmentNumber: item.equipment_number,
            name: item.name,
            manufacturer: item.manufacturer,
            model: item.model,
            locationDetail: item.location_detail,
          })),
      })),
    contacts: (contactsByClient.get(client.id) ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name,
      })),
  }));
}

async function hydrateListItems(
  admin: AdminClient,
  organizationId: string,
  rows: ServiceCaseRow[],
): Promise<ServiceCaseListItem[]> {
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((row) => row.client_id))];
  const siteIds = [...new Set(rows.map((row) => row.site_id))];
  const jobIds = [...new Set(rows.flatMap((row) => (row.job_id ? [row.job_id] : [])))];
  const caseIds = rows.map((row) => row.id);
  const [clientsResult, sitesResult, jobsResult, linksResult] = await Promise.all([
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
    jobIds.length
      ? admin
          .from("jobs")
          .select("id, job_number, title")
          .eq("organization_id", organizationId)
          .in("id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("service_case_equipment_links")
      .select("service_case_id, equipment_id")
      .eq("organization_id", organizationId)
      .in("service_case_id", caseIds),
  ]);
  if (
    clientsResult.error ||
    sitesResult.error ||
    jobsResult.error ||
    linksResult.error
  ) {
    throw new Error("service_case_hydration_failed");
  }
  const equipmentIds = [
    ...new Set((linksResult.data ?? []).map((link) => link.equipment_id)),
  ];
  const equipmentResult = equipmentIds.length
    ? await admin
        .from("installed_equipment")
        .select("id, equipment_number, name, manufacturer, model, location_detail")
        .eq("organization_id", organizationId)
        .in("id", equipmentIds)
    : { data: [], error: null };
  if (equipmentResult.error) throw new Error("service_case_equipment_failed");
  const clients = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client.name]),
  );
  const sites = new Map((sitesResult.data ?? []).map((site) => [site.id, site]));
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const equipment = new Map<string, ServiceCaseEquipment>(
    (equipmentResult.data ?? []).map((item) => [
      item.id,
      {
        id: item.id,
        equipmentNumber: item.equipment_number,
        name: item.name,
        manufacturer: item.manufacturer,
        model: item.model,
        locationDetail: item.location_detail,
      },
    ]),
  );
  const equipmentByCase = new Map<string, ServiceCaseEquipment[]>();
  for (const link of linksResult.data ?? []) {
    const item = equipment.get(link.equipment_id);
    if (!item) continue;
    const values = equipmentByCase.get(link.service_case_id) ?? [];
    values.push(item);
    equipmentByCase.set(link.service_case_id, values);
  }
  return rows.flatMap((row) => {
    const clientName = clients.get(row.client_id);
    const site = sites.get(row.site_id);
    if (!clientName || !site) return [];
    const job = row.job_id ? jobs.get(row.job_id) : null;
    return [
      {
        id: row.id,
        caseNumber: row.case_number,
        intakeType: row.intake_type,
        sourceRequestId: row.source_request_id,
        clientId: row.client_id,
        clientName,
        siteId: row.site_id,
        siteName: site.name,
        siteAddress: formatAddress(site),
        summary: row.summary,
        urgency: row.urgency,
        status: row.status,
        chargeContext: row.charge_context,
        jobId: row.job_id,
        jobNumber: job?.job_number ?? null,
        jobTitle: job?.title ?? null,
        equipment: equipmentByCase.get(row.id) ?? [],
        version: row.version,
        updatedAt: row.updated_at,
      },
    ];
  });
}

export async function getServiceCaseList(): Promise<ServiceCaseListResult> {
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin
    .from("service_cases")
    .select("*")
    .eq("organization_id", context.organizationId)
    .order("updated_at", { ascending: false });
  if (error) return { success: false, error: "service_case_load_failed" };
  try {
    const [cases, clients] = await Promise.all([
      hydrateListItems(context.admin, context.organizationId, data ?? []),
      loadClientOptions(context.admin, context.organizationId),
    ]);
    return { success: true, workspace: { cases, clients } };
  } catch (cause) {
    console.error(
      "service_case_list_load_failed",
      cause instanceof Error ? cause.message : "unknown",
    );
    return { success: false, error: "service_case_load_failed" };
  }
}

async function loadDetailRelations(
  admin: AdminClient,
  organizationId: string,
  caseId: string,
): Promise<ServiceCaseRelation[]> {
  const { data, error } = await admin
    .from("service_case_relations")
    .select("*")
    .eq("organization_id", organizationId)
    .or(`service_case_id.eq.${caseId},related_service_case_id.eq.${caseId}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error("service_case_relations_failed");
  const relatedIds = (data ?? []).map((relation) =>
    relation.service_case_id === caseId
      ? relation.related_service_case_id
      : relation.service_case_id,
  );
  const casesResult = relatedIds.length
    ? await admin
        .from("service_cases")
        .select("id, case_number, summary")
        .eq("organization_id", organizationId)
        .in("id", relatedIds)
    : { data: [], error: null };
  if (casesResult.error) throw new Error("service_case_relations_failed");
  const cases = new Map((casesResult.data ?? []).map((item) => [item.id, item]));
  return (data ?? []).flatMap((relation) => {
    const relatedId =
      relation.service_case_id === caseId
        ? relation.related_service_case_id
        : relation.service_case_id;
    const related = cases.get(relatedId);
    if (!related) return [];
    return [
      {
        id: relation.id,
        relationType: relation.relation_type,
        relatedCaseId: related.id,
        relatedCaseNumber: related.case_number,
        relatedSummary: related.summary,
        reason: relation.reason,
        createdAt: relation.created_at,
      },
    ];
  });
}

async function loadDetailEvidence(
  admin: AdminClient,
  organizationId: string,
  caseId: string,
) {
  const { data: links, error } = await admin
    .from("service_case_evidence_links")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_case_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("service_case_evidence_failed");
  const revisionIds = (links ?? []).map((link) => link.work_artifact_revision_id);
  const revisionResult = revisionIds.length
    ? await admin
        .from("work_artifact_revisions")
        .select("id, artifact_id, revision_number, title, kind")
        .eq("organization_id", organizationId)
        .in("id", revisionIds)
    : { data: [], error: null };
  if (revisionResult.error) throw new Error("service_case_evidence_failed");
  const revisions = new Map(
    (revisionResult.data ?? []).map((revision) => [revision.id, revision]),
  );
  return (links ?? []).flatMap((link) => {
    const revision = revisions.get(link.work_artifact_revision_id);
    return revision
      ? [
          {
            id: link.id,
            revisionId: revision.id,
            artifactId: revision.artifact_id,
            revisionNumber: revision.revision_number,
            title: revision.title,
            kind: revision.kind,
            createdAt: link.created_at,
          },
        ]
      : [];
  });
}

async function loadDetailDocuments(
  admin: AdminClient,
  organizationId: string,
  caseId: string,
): Promise<ServiceCaseDocument[]> {
  const { data: links, error } = await admin
    .from("document_links")
    .select("id, document_id")
    .eq("organization_id", organizationId)
    .eq("service_case_id", caseId);
  if (error) throw new Error("service_case_documents_failed");
  const documentIds = (links ?? []).map((link) => link.document_id);
  const documentsResult = documentIds.length
    ? await admin
        .from("documents")
        .select("id, display_name, category, current_version_number")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("id", documentIds)
    : { data: [], error: null };
  if (documentsResult.error) throw new Error("service_case_documents_failed");
  const documents = new Map(
    (documentsResult.data ?? []).map((document) => [document.id, document]),
  );
  return (links ?? []).flatMap((link) => {
    const document = documents.get(link.document_id);
    return document
      ? [
          {
            linkId: link.id,
            documentId: document.id,
            displayName: document.display_name,
            category: document.category,
            currentVersionNumber: document.current_version_number,
          },
        ]
      : [];
  });
}

async function loadEvidenceOptions(
  admin: AdminClient,
  organizationId: string,
  jobId: string | null,
  linkedRevisionIds: Set<string>,
): Promise<ServiceCaseEvidenceOption[]> {
  if (!jobId) return [];
  const artifactsResult = await admin
    .from("work_artifacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .is("voided_at", null);
  if (artifactsResult.error) throw new Error("service_case_evidence_failed");
  const artifactIds = (artifactsResult.data ?? []).map((artifact) => artifact.id);
  if (artifactIds.length === 0) return [];
  const revisionsResult = await admin
    .from("work_artifact_revisions")
    .select("id, artifact_id, revision_number, title, kind")
    .eq("organization_id", organizationId)
    .in("artifact_id", artifactIds)
    .order("captured_at", { ascending: false });
  if (revisionsResult.error) throw new Error("service_case_evidence_failed");
  return (revisionsResult.data ?? [])
    .filter((revision) => !linkedRevisionIds.has(revision.id))
    .map((revision) => ({
      revisionId: revision.id,
      artifactId: revision.artifact_id,
      revisionNumber: revision.revision_number,
      title: revision.title,
      kind: revision.kind,
    }));
}

async function loadFollowUpOwnerOptions(
  admin: AdminClient,
  organizationId: string,
): Promise<ServiceCaseDetailWorkspace["followUpOwners"]> {
  const membershipsResult = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .in("role", ["admin", "buero"]);
  if (membershipsResult.error) throw new Error("service_case_owners_failed");
  const userIds = (membershipsResult.data ?? []).map((member) => member.user_id);
  const profilesResult = userIds.length
    ? await admin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", userIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error("service_case_owners_failed");
  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  return (membershipsResult.data ?? [])
    .map((member) => {
      const profile = profiles.get(member.user_id);
      return {
        userId: member.user_id,
        name:
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
          profile?.email ||
          "Unbekannt",
        role: member.role as "admin" | "buero",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "de"));
}

export async function getServiceCaseDetailByNumber(
  caseNumber: string,
): Promise<ServiceCaseDetailResult> {
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const { data: row, error } = await context.admin
    .from("service_cases")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("case_number", caseNumber.trim().toUpperCase())
    .maybeSingle();
  if (error || !row) return { success: false, error: "service_case_not_found" };

  try {
  const [listItems, clients, eventsResult, relations, evidence, documents, jobsResult, casesResult, contactResult, followUpOwners] =
    await Promise.all([
      hydrateListItems(context.admin, context.organizationId, [row]),
      loadClientOptions(context.admin, context.organizationId),
      context.admin
        .from("service_case_events")
        .select("*")
        .eq("organization_id", context.organizationId)
        .eq("service_case_id", row.id)
        .order("recorded_at", { ascending: false }),
      loadDetailRelations(context.admin, context.organizationId, row.id),
      loadDetailEvidence(context.admin, context.organizationId, row.id),
      loadDetailDocuments(context.admin, context.organizationId, row.id),
      context.admin
        .from("jobs")
        .select("id, job_number, title, client_id, site_id")
        .eq("organization_id", context.organizationId)
        .eq("client_id", row.client_id)
        .eq("site_id", row.site_id)
        .order("created_at", { ascending: false }),
      context.admin
        .from("service_cases")
        .select("id, case_number, summary")
        .eq("organization_id", context.organizationId)
        .eq("client_id", row.client_id)
        .neq("id", row.id)
        .order("updated_at", { ascending: false }),
      row.contact_id
        ? context.admin
            .from("client_contacts")
            .select("name")
            .eq("id", row.contact_id)
            .eq("organization_id", context.organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      loadFollowUpOwnerOptions(context.admin, context.organizationId),
    ]);
  if (
    !listItems[0] ||
    eventsResult.error ||
    jobsResult.error ||
    casesResult.error ||
    contactResult.error
  ) {
    return { success: false, error: "service_case_load_failed" };
  }
  const actorIds = [...new Set((eventsResult.data ?? []).map((event) => event.actor_id))];
  const actorsResult = actorIds.length
    ? await context.admin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", actorIds)
    : { data: [], error: null };
  if (actorsResult.error) throw new Error("service_case_actors_failed");
  const actorNames = new Map(
    (actorsResult.data ?? []).map((actor) => [
      actor.id,
      [actor.first_name, actor.last_name].filter(Boolean).join(" ") ||
        actor.email ||
        "Unbekannt",
    ]),
  );
  const events: ServiceCaseEvent[] = (eventsResult.data ?? []).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    actorName: actorNames.get(event.actor_id) ?? "Unbekannt",
    reason: event.reason,
    beforeSnapshot: event.before_snapshot,
    afterSnapshot: event.after_snapshot,
    recordedAt: event.recorded_at,
  }));
  const contactName = contactResult.data?.name ?? null;
  const serviceCase: ServiceCaseDetail = {
    ...listItems[0],
    contactId: row.contact_id,
    contactName,
    originalStatement: row.original_statement,
    originalDetails: row.original_details,
    accessInstructions: row.access_instructions,
    triageNote: row.triage_note,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    events,
    relations,
    evidence,
    documents,
  };
  const jobs: ServiceCaseJobOption[] = (jobsResult.data ?? []).map((job) => ({
    id: job.id,
    jobNumber: job.job_number,
    title: job.title,
    clientId: job.client_id,
    siteId: job.site_id,
  }));
  const evidenceOptions = await loadEvidenceOptions(
    context.admin,
    context.organizationId,
    row.job_id,
    new Set(evidence.map((item) => item.revisionId)),
  );
  return {
    success: true,
    workspace: {
      serviceCase,
      currentActorId: context.actorId,
      clients,
      jobs,
      relatedCases: (casesResult.data ?? []).map((relatedCase) => ({
        id: relatedCase.id,
        caseNumber: relatedCase.case_number,
        summary: relatedCase.summary,
      })),
      evidenceOptions,
      followUpOwners,
    },
  };
  } catch (cause) {
    console.error(
      "service_case_detail_load_failed",
      cause instanceof Error ? cause.message : "unknown",
    );
    return { success: false, error: "service_case_load_failed" };
  }
}

function refreshServicePaths(caseNumber?: string): void {
  revalidatePath("/service/faelle");
  revalidatePath("/anfragen");
  if (caseNumber) revalidatePath(`/service/faelle/${caseNumber}`);
}

async function refreshServiceCasePathsById(
  admin: AdminClient,
  organizationId: string,
  serviceCaseId: string,
): Promise<void> {
  const { data } = await admin
    .from("service_cases")
    .select("case_number")
    .eq("organization_id", organizationId)
    .eq("id", serviceCaseId)
    .maybeSingle();
  refreshServicePaths(data?.case_number);
}

export async function createServiceCase(
  input: ServiceCaseCreateInput,
): Promise<ServiceCaseMutationResult> {
  const parsed = serviceCaseCreateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const { data, error } = await context.admin.rpc("create_service_case", {
    p_organization_id: context.organizationId,
    p_service_case_id: parsed.data.serviceCaseId,
    p_payload: parsed.data as unknown as Json,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) {
    return { success: false, error: mutationError(error, "service_case_create_failed") };
  }
  refreshServicePaths(data.case_number);
  return { success: true, serviceCase: data };
}

export async function updateServiceCase(
  input: ServiceCaseUpdateInput,
): Promise<ServiceCaseMutationResult> {
  const parsed = serviceCaseUpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const payload = {
    summary: parsed.data.summary,
    urgency: parsed.data.urgency,
    status: parsed.data.status,
    chargeContext: parsed.data.chargeContext,
    accessInstructions: parsed.data.accessInstructions ?? null,
    triageNote: parsed.data.triageNote ?? null,
    resolutionNote: parsed.data.resolutionNote ?? null,
    jobId: parsed.data.jobId ?? null,
    equipmentIds: parsed.data.equipmentIds,
  };
  const { data, error } = await context.admin.rpc("update_service_case", {
    p_organization_id: context.organizationId,
    p_service_case_id: parsed.data.serviceCaseId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: payload,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) {
    return { success: false, error: mutationError(error, "service_case_update_failed") };
  }
  refreshServicePaths(data.case_number);
  return { success: true, serviceCase: data };
}

export async function linkServiceCaseRelation(
  input: ServiceCaseRelationInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = serviceCaseRelationSchema.safeParse(input);
  if (!parsed.success || parsed.data.serviceCaseId === parsed.data.relatedServiceCaseId) {
    return { success: false, error: "invalid_input" };
  }
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("link_service_case_relation", {
    p_organization_id: context.organizationId,
    p_service_case_id: parsed.data.serviceCaseId,
    p_related_service_case_id: parsed.data.relatedServiceCaseId,
    p_relation_type: parsed.data.relationType,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return { success: false, error: mutationError(error, "service_case_relation_failed") };
  }
  await refreshServiceCasePathsById(
    context.admin,
    context.organizationId,
    parsed.data.serviceCaseId,
  );
  return { success: true };
}

export async function linkServiceCaseEvidence(
  input: ServiceCaseEvidenceInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = serviceCaseEvidenceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "invalid_input" };
  const context = await requireServiceManager();
  if ("success" in context) return context;
  const { error } = await context.admin.rpc("link_service_case_evidence", {
    p_organization_id: context.organizationId,
    p_service_case_id: parsed.data.serviceCaseId,
    p_work_artifact_revision_id: parsed.data.workArtifactRevisionId,
    p_expected_version: parsed.data.expectedVersion,
    p_actor_id: context.actorId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    return { success: false, error: mutationError(error, "service_case_evidence_failed") };
  }
  await refreshServiceCasePathsById(
    context.admin,
    context.organizationId,
    parsed.data.serviceCaseId,
  );
  return { success: true };
}

export async function getAssignedServiceContextForJob(
  jobId: string,
): Promise<FieldServiceContextResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  if (!auth.context.isManagerOrAbove) {
    const { data: assignment } = await admin
      .from("job_assignments")
      .select("id")
      .eq("organization_id", auth.context.orgId)
      .eq("job_id", jobId)
      .eq("user_id", auth.context.userId)
      .maybeSingle();
    if (!assignment) return { success: false, error: "not_authorized" };
  }
  const { data: rows, error } = await admin
    .from("service_cases")
    .select("*")
    .eq("organization_id", auth.context.orgId)
    .eq("job_id", jobId)
    .not("status", "in", "(closed_without_visit,duplicate)");
  if (error) return { success: false, error: "service_context_load_failed" };
  if (!rows?.length) return { success: true, contexts: [] };
  try {
    const items = await hydrateListItems(admin, auth.context.orgId, rows);
    const contexts: FieldServiceContext[] = items.map((item) => ({
      caseNumber: item.caseNumber,
      summary: item.summary,
      urgency: item.urgency,
      accessInstructions:
        rows.find((row) => row.id === item.id)?.access_instructions ?? null,
      equipment: item.equipment,
    }));
    return { success: true, contexts };
  } catch (cause) {
    console.error(
      "service_context_load_failed",
      cause instanceof Error ? cause.message : "unknown",
    );
    return { success: false, error: "service_context_load_failed" };
  }
}
