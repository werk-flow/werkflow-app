import { createAdminClient, withRoleClient } from './shared';

export async function getInstalledEquipmentState(
  orgId: string,
  equipmentNumber: string,
) {
  const admin = createAdminClient();
  const equipmentResult = await admin
    .from("installed_equipment")
    .select("*")
    .eq("organization_id", orgId)
    .eq("equipment_number", equipmentNumber)
    .single();
  if (equipmentResult.error) {
    throw new Error(
      `Equipment lookup failed: ${equipmentResult.error.message}`,
    );
  }
  const equipmentId = equipmentResult.data.id;
  const [
    identifiersResult,
    eventsResult,
    workLinksResult,
    documentLinksResult,
  ] = await Promise.all([
    admin
      .from("installed_equipment_identifiers")
      .select("*")
      .eq("organization_id", orgId)
      .eq("equipment_id", equipmentId)
      .order("created_at"),
    admin
      .from("installed_equipment_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("equipment_id", equipmentId)
      .order("recorded_at"),
    admin
      .from("installed_equipment_work_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("equipment_id", equipmentId),
    admin
      .from("document_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("equipment_id", equipmentId),
  ]);
  const error =
    identifiersResult.error ??
    eventsResult.error ??
    workLinksResult.error ??
    documentLinksResult.error;
  if (error)
    throw new Error(`Equipment ledger lookup failed: ${error.message}`);
  return {
    equipment: equipmentResult.data,
    identifiers: identifiersResult.data ?? [],
    events: eventsResult.data ?? [],
    workLinks: workLinksResult.data ?? [],
    documentLinks: documentLinksResult.data ?? [],
  };
}

export async function getInstalledEquipmentNumberByName(
  orgId: string,
  name: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("installed_equipment")
    .select("equipment_number")
    .eq("organization_id", orgId)
    .eq("name", name)
    .is("voided_at", null)
    .maybeSingle();
  if (error)
    throw new Error(`Equipment identity lookup failed: ${error.message}`);
  return data?.equipment_number ?? null;
}

export async function getInstalledEquipmentCountsAs(
  user: { email: string; password: string },
  orgId: string,
) {
  return withRoleClient(user, async (client) => {
    const tables = [
      "installed_equipment",
      "installed_equipment_identifiers",
      "installed_equipment_events",
      "installed_equipment_event_links",
      "installed_equipment_work_links",
    ] as const;
    const counts = {} as Record<(typeof tables)[number], number>;
    for (const table of tables) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error)
        throw new Error(
          `Equipment RLS lookup failed for ${table}: ${error.message}`,
        );
      counts[table] = count ?? 0;
    }
    return counts;
  });
}

export async function getServiceCaseStateByNumber(
  orgId: string,
  caseNumber: string,
) {
  const admin = createAdminClient();
  const { data: serviceCase, error } = await admin
    .from("service_cases")
    .select("*")
    .eq("organization_id", orgId)
    .eq("case_number", caseNumber)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Service case ${caseNumber} lookup failed: ${error.message}`,
    );
  }
  if (!serviceCase) {
    throw new Error(`Service case ${caseNumber} not found in org ${orgId}`);
  }
  const [
    events,
    equipmentLinks,
    relations,
    evidenceLinks,
    documents,
    followUps,
  ] = await Promise.all([
    admin
      .from("service_case_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("service_case_id", serviceCase.id)
      .order("recorded_at"),
    admin
      .from("service_case_equipment_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("service_case_id", serviceCase.id),
    admin
      .from("service_case_relations")
      .select("*")
      .eq("organization_id", orgId)
      .or(
        `service_case_id.eq.${serviceCase.id},related_service_case_id.eq.${serviceCase.id}`,
      ),
    admin
      .from("service_case_evidence_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("service_case_id", serviceCase.id),
    admin
      .from("document_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("service_case_id", serviceCase.id),
    admin
      .from("client_follow_ups")
      .select("*")
      .eq("organization_id", orgId)
      .eq("source_type", "service_case")
      .eq("source_id", serviceCase.id),
  ]);
  for (const result of [
    events,
    equipmentLinks,
    relations,
    evidenceLinks,
    documents,
    followUps,
  ]) {
    if (result.error)
      throw new Error(
        `Service case state lookup failed: ${result.error.message}`,
      );
  }
  return {
    serviceCase,
    events: events.data ?? [],
    equipmentLinks: equipmentLinks.data ?? [],
    relations: relations.data ?? [],
    evidenceLinks: evidenceLinks.data ?? [],
    documentLinks: documents.data ?? [],
    followUps: followUps.data ?? [],
  };
}

export async function getServiceCaseNumberBySummary(
  orgId: string,
  summary: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_cases")
    .select("case_number")
    .eq("organization_id", orgId)
    .eq("summary", summary)
    .maybeSingle();
  if (error) throw new Error(`Service case lookup failed: ${error.message}`);
  return data?.case_number ?? null;
}

export async function getServiceCaseCountsAs(
  user: { email: string; password: string },
  orgId: string,
  serviceCaseId: string,
) {
  return withRoleClient(user, async (client) => {
    const tables = [
      "service_cases",
      "service_case_events",
      "service_case_equipment_links",
      "service_case_relations",
      "service_case_evidence_links",
    ] as const;
    const counts = {} as Record<
      (typeof tables)[number] | "client_follow_ups",
      number
    >;
    for (const table of tables) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error) {
        throw new Error(
          `Service case RLS lookup failed for ${table}: ${error.message}`,
        );
      }
      counts[table] = count ?? 0;
    }
    const { count: followUpCount, error: followUpError } = await client
      .from("client_follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("source_type", "service_case")
      .eq("source_id", serviceCaseId);
    if (followUpError) {
      throw new Error(
        `Service case RLS lookup failed for client_follow_ups: ${followUpError.message}`,
      );
    }
    counts.client_follow_ups = followUpCount ?? 0;
    return counts;
  });
}

export async function getMaintenanceCoverageStateByReference(
  orgId: string,
  reference: string,
) {
  const admin = createAdminClient();
  const { data: coverage, error: coverageError } = await admin
    .from("maintenance_coverages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("reference", reference)
    .maybeSingle();
  if (coverageError) {
    throw new Error(
      `Maintenance coverage lookup failed: ${coverageError.message}`,
    );
  }
  if (!coverage) return null;
  const [events, documents, followUps] = await Promise.all([
    admin
      .from("maintenance_coverage_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_coverage_id", coverage.id)
      .order("recorded_at"),
    admin
      .from("document_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_coverage_id", coverage.id),
    admin
      .from("client_follow_ups")
      .select("*")
      .eq("organization_id", orgId)
      .eq("source_type", "maintenance_coverage")
      .eq("source_id", coverage.id),
  ]);
  for (const result of [events, documents, followUps]) {
    if (result.error) {
      throw new Error(
        `Maintenance coverage state failed: ${result.error.message}`,
      );
    }
  }
  return {
    coverage,
    events: events.data ?? [],
    documentLinks: documents.data ?? [],
    followUps: followUps.data ?? [],
  };
}

export async function getMaintenanceStateByPlanNumber(
  orgId: string,
  planNumber: string,
) {
  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from("maintenance_plans")
    .select("*")
    .eq("organization_id", orgId)
    .eq("plan_number", planNumber)
    .maybeSingle();
  if (error)
    throw new Error(`Maintenance plan lookup failed: ${error.message}`);
  if (!plan) return null;
  if (!plan.current_revision_id) {
    throw new Error(`Maintenance plan ${planNumber} has no current revision.`);
  }
  const dueWork = await admin
    .from("maintenance_due_work")
    .select("*")
    .eq("organization_id", orgId)
    .eq("maintenance_plan_id", plan.id)
    .order("due_date");
  if (dueWork.error) {
    throw new Error(
      `Maintenance state lookup failed: ${dueWork.error.message}`,
    );
  }
  const dueWorkIds = (dueWork.data ?? []).map((due) => due.id);
  const [
    revisions,
    equipment,
    planEvents,
    dueEvents,
    evidenceLinks,
    serviceCaseLinks,
  ] = await Promise.all([
    admin
      .from("maintenance_plan_revisions")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_plan_id", plan.id)
      .order("revision_number"),
    admin
      .from("maintenance_plan_revision_equipment")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_plan_revision_id", plan.current_revision_id),
    admin
      .from("maintenance_plan_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_plan_id", plan.id)
      .order("recorded_at"),
    dueWorkIds.length > 0
      ? admin
          .from("maintenance_due_work_events")
          .select("*")
          .eq("organization_id", orgId)
          .in("maintenance_due_work_id", dueWorkIds)
          .order("recorded_at")
      : Promise.resolve({ data: [], error: null }),
    dueWorkIds.length > 0
      ? admin
          .from("maintenance_due_evidence_links")
          .select("*")
          .eq("organization_id", orgId)
          .in("maintenance_due_work_id", dueWorkIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("maintenance_service_case_links")
      .select("*")
      .eq("organization_id", orgId)
      .eq("maintenance_plan_id", plan.id),
  ]);
  for (const result of [
    revisions,
    equipment,
    planEvents,
    dueEvents,
    evidenceLinks,
    serviceCaseLinks,
  ]) {
    if (result.error) {
      throw new Error(
        `Maintenance state lookup failed: ${result.error.message}`,
      );
    }
  }
  return {
    plan,
    revisions: revisions.data ?? [],
    equipment: equipment.data ?? [],
    dueWork: dueWork.data ?? [],
    planEvents: planEvents.data ?? [],
    dueEvents: dueEvents.data ?? [],
    evidenceLinks: evidenceLinks.data ?? [],
    serviceCaseLinks: serviceCaseLinks.data ?? [],
  };
}

export async function getMaintenancePlanNumberByClient(
  orgId: string,
  clientId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_plans")
    .select("plan_number")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Maintenance plan number lookup failed: ${error.message}`);
  return data?.plan_number ?? null;
}

export async function getMaintenancePlanNumbersByClient(
  orgId: string,
  clientId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  // Oldest first: the exhaustive lifecycle audit deliberately addresses the
  // original plan before the overlapping plan created in its next stage.
  const { data, error } = await admin
    .from("maintenance_plans")
    .select("plan_number")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at")
    .order("plan_number");
  if (error)
    throw new Error(`Maintenance plan lookup failed: ${error.message}`);
  return (data ?? []).map((plan) => plan.plan_number);
}

export async function getMaintenanceCountsAs(
  user: { email: string; password: string },
  orgId: string,
) {
  return withRoleClient(user, async (client) => {
    const tables = [
      "maintenance_coverages",
      "maintenance_plans",
      "maintenance_due_work",
      "maintenance_plan_revisions",
      "maintenance_plan_events",
      "maintenance_due_work_events",
    ] as const;
    const counts = {} as Record<(typeof tables)[number], number>;
    for (const table of tables) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (error) {
        throw new Error(
          `Maintenance RLS lookup failed for ${table}: ${error.message}`,
        );
      }
      counts[table] = count ?? 0;
    }
    return counts;
  });
}
