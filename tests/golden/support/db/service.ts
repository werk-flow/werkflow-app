import { randomUUID } from 'node:crypto';

import {
  equipmentCreateSchema,
  equipmentReplacementSchema,
  equipmentTransitionSchema,
} from '../../../../lib/installed-equipment/validation';
import type { EquipmentCategory } from '../../../../lib/installed-equipment/types';
import { maintenanceCoverageSchema, maintenancePlanSchema } from '../../../../lib/maintenance/validation';
import { addLocalMonthsClamped } from '../../../../lib/planning/date-time';
import { serviceCaseCreateSchema } from '../../../../lib/service-cases/validation';
import { toJson } from '../../../../lib/supabase/json';
import type { ServiceCaseChargeContext } from '../../../../lib/service-cases/types';
import { createAdminClient } from './shared';

// Seeds below call the same guarded RPCs as the manager actions, with payloads
// parsed by the product schemas, so a test that claims a later service flow
// starts from records the UI could have written.

type SeedActor = { orgId: string; actorId: string };

/** Registers one installed equipment at a customer's site; a serial number is issued by its manufacturer. */
export async function seedInstalledEquipment(
  input: SeedActor & {
    clientId: string;
    siteId: string;
    name: string;
    category?: EquipmentCategory;
    parentEquipmentId?: string;
    state?: 'unknown' | 'active' | 'inactive';
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
  },
): Promise<{ id: string; equipmentNumber: string }> {
  const payload = equipmentCreateSchema.parse({
    equipmentId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientId: input.clientId,
    siteId: input.siteId,
    parentEquipmentId: input.parentEquipmentId ?? null,
    name: input.name,
    category: input.category ?? 'heat_generation',
    state: input.state ?? 'active',
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    identifiers: input.serialNumber
      ? [{ identifierType: 'serial_number', value: input.serialNumber, issuer: input.manufacturer ?? null }]
      : [],
  });
  const { data } = await createAdminClient()
    .rpc('create_installed_equipment', {
      p_organization_id: input.orgId,
      p_equipment_id: payload.equipmentId,
      p_payload: toJson(payload),
      p_actor_id: input.actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  if (!data) throw new Error(`Equipment seed returned no record for ${input.name}.`);
  return { id: data.id, equipmentNumber: data.equipment_number };
}

/**
 * Takes an equipment out of service and records its replacement as a terminal
 * action, the state a manager corrects when the exchange was recorded on the wrong asset.
 */
export async function seedInstalledEquipmentReplacement(
  input: SeedActor & {
    predecessorId: string;
    inactiveReason: string;
    successorName: string;
    successorSerialNumber: string;
    reason: string;
  },
): Promise<{ id: string; equipmentNumber: string }> {
  const admin = createAdminClient();
  const { data: predecessor } = await admin
    .from('installed_equipment')
    .select('client_id, site_id, parent_equipment_id, category, version')
    .eq('organization_id', input.orgId)
    .eq('id', input.predecessorId)
    .single()
    .throwOnError();
  const transition = equipmentTransitionSchema.parse({
    equipmentId: input.predecessorId,
    expectedVersion: predecessor.version,
    toState: 'inactive',
    effectiveAt: new Date().toISOString(),
    reason: input.inactiveReason,
    idempotencyKey: randomUUID(),
  });
  const { data: inactive } = await admin
    .rpc('transition_installed_equipment', {
      p_organization_id: input.orgId,
      p_equipment_id: transition.equipmentId,
      p_expected_version: transition.expectedVersion,
      p_to_state: transition.toState,
      p_effective_at: transition.effectiveAt,
      p_reason: transition.reason,
      p_actor_id: input.actorId,
      p_idempotency_key: transition.idempotencyKey,
    })
    .throwOnError();
  if (!inactive) throw new Error('Equipment transition seed returned no record.');
  const replacement = equipmentReplacementSchema.parse({
    predecessorId: input.predecessorId,
    successorId: randomUUID(),
    expectedVersion: inactive.version,
    effectiveAt: new Date().toISOString(),
    reason: input.reason,
    idempotencyKey: randomUUID(),
    clientId: predecessor.client_id,
    siteId: predecessor.site_id,
    parentEquipmentId: predecessor.parent_equipment_id,
    name: input.successorName,
    category: predecessor.category,
    state: 'unknown',
    identifiers: [{ identifierType: 'serial_number', value: input.successorSerialNumber, issuer: null }],
  });
  const { data: successor } = await admin
    .rpc('replace_installed_equipment', {
      p_organization_id: input.orgId,
      p_predecessor_id: replacement.predecessorId,
      p_successor_id: replacement.successorId,
      p_expected_version: replacement.expectedVersion,
      p_successor_payload: toJson(replacement),
      p_effective_at: replacement.effectiveAt,
      p_reason: replacement.reason,
      p_actor_id: input.actorId,
      p_idempotency_key: replacement.idempotencyKey,
    })
    .throwOnError();
  if (!successor)
    throw new Error(`Equipment replacement seed returned no record for ${input.successorName}.`);
  return { id: successor.id, equipmentNumber: successor.equipment_number };
}

/** Records a direct service case at a customer's site, optionally linked to installed equipment. */
export async function seedServiceCase(
  input: SeedActor & {
    clientId: string;
    siteId: string;
    summary: string;
    statement: string;
    chargeContext?: ServiceCaseChargeContext;
    accessInstructions?: string;
    triageNote?: string;
    equipmentIds?: readonly string[];
  },
): Promise<{ id: string; caseNumber: string }> {
  const payload = serviceCaseCreateSchema.parse({
    serviceCaseId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientId: input.clientId,
    siteId: input.siteId,
    originalStatement: input.statement,
    summary: input.summary,
    chargeContext: input.chargeContext ?? 'unknown',
    accessInstructions: input.accessInstructions ?? null,
    triageNote: input.triageNote ?? null,
    equipmentIds: [...(input.equipmentIds ?? [])],
  });
  const { data } = await createAdminClient()
    .rpc('create_service_case', {
      p_organization_id: input.orgId,
      p_service_case_id: payload.serviceCaseId,
      p_payload: toJson(payload),
      p_actor_id: input.actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  if (!data) throw new Error(`Service case seed returned no record for ${input.summary}.`);
  return { id: data.id, caseNumber: data.case_number };
}

/** Records an active operational coverage for a customer's site. */
export async function seedMaintenanceCoverage(
  input: SeedActor & {
    clientId: string;
    siteId: string;
    reference: string;
    validFrom: string;
    validUntil: string;
    operationalNote?: string;
  },
): Promise<{ id: string; coverageNumber: string }> {
  const payload = maintenanceCoverageSchema.parse({
    coverageId: randomUUID(),
    clientId: input.clientId,
    siteId: input.siteId,
    reference: input.reference,
    description: null,
    status: 'active',
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    noticeDate: null,
    renewalDate: null,
    reviewDueDate: null,
    operationalNote: input.operationalNote ?? null,
    idempotencyKey: randomUUID(),
  });
  const { data } = await createAdminClient()
    .rpc('create_maintenance_coverage', {
      p_organization_id: input.orgId,
      p_maintenance_coverage_id: payload.coverageId,
      p_payload: toJson(payload),
      p_actor_id: input.actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  if (!data) throw new Error(`Maintenance coverage seed returned no record for ${input.reference}.`);
  return { id: data.id, coverageNumber: data.coverage_number };
}

/**
 * Activates a maintenance plan and materializes its due work through the same
 * 18-month horizon the manager action generates from the business date.
 */
export async function seedMaintenancePlan(
  input: SeedActor & {
    clientId: string;
    siteId: string;
    templateVersionId: string;
    equipmentIds: readonly string[];
    effectiveFromDate: string;
    firstDueDate: string;
    intervalMonths: number;
    businessDate: string;
    coverageId?: string;
    instructions?: string;
    overlapReason?: string;
  },
): Promise<{ id: string; planNumber: string }> {
  const payload = maintenancePlanSchema.parse({
    planId: randomUUID(),
    revisionId: randomUUID(),
    clientId: input.clientId,
    siteId: input.siteId,
    maintenanceCoverageId: input.coverageId ?? null,
    status: 'active',
    templateVersionId: input.templateVersionId,
    effectiveFromDate: input.effectiveFromDate,
    firstDueDate: input.firstDueDate,
    intervalMonths: input.intervalMonths,
    dueWindowBeforeDays: 14,
    dueWindowAfterDays: 14,
    plannedDurationMinutes: 120,
    nextDueBasis: 'planned_due_date',
    operationalInstructions: input.instructions ?? null,
    overlapReason: input.overlapReason ?? null,
    reason: 'Wartungsplan angelegt',
    equipmentIds: [...input.equipmentIds],
    idempotencyKey: randomUUID(),
  });
  const admin = createAdminClient();
  const { data: plan } = await admin
    .rpc('create_maintenance_plan', {
      p_organization_id: input.orgId,
      p_maintenance_plan_id: payload.planId,
      p_revision_id: payload.revisionId,
      p_payload: toJson(payload),
      p_actor_id: input.actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  if (!plan) throw new Error('Maintenance plan seed returned no record.');
  await admin
    .rpc('generate_maintenance_due_work', {
      p_organization_id: input.orgId,
      p_maintenance_plan_id: payload.planId,
      p_expected_version: plan.version,
      p_through_date: addLocalMonthsClamped(input.businessDate, 18),
      p_actor_id: input.actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  return { id: plan.id, planNumber: plan.plan_number };
}

export async function getInstalledEquipmentState(orgId: string, equipmentNumber: string) {
  const admin = createAdminClient();
  const equipmentResult = await admin
    .from('installed_equipment')
    .select('*')
    .eq('organization_id', orgId)
    .eq('equipment_number', equipmentNumber)
    .single();
  if (equipmentResult.error) {
    throw new Error(`Equipment lookup failed: ${equipmentResult.error.message}`);
  }
  const equipmentId = equipmentResult.data.id;
  const [identifiersResult, eventsResult, workLinksResult, documentLinksResult] = await Promise.all([
    admin
      .from('installed_equipment_identifiers')
      .select('*')
      .eq('organization_id', orgId)
      .eq('equipment_id', equipmentId)
      .order('created_at'),
    admin
      .from('installed_equipment_events')
      .select('*')
      .eq('organization_id', orgId)
      .eq('equipment_id', equipmentId)
      .order('recorded_at'),
    admin
      .from('installed_equipment_work_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('equipment_id', equipmentId),
    admin.from('document_links').select('*').eq('organization_id', orgId).eq('equipment_id', equipmentId),
  ]);
  const error =
    identifiersResult.error ?? eventsResult.error ?? workLinksResult.error ?? documentLinksResult.error;
  if (error) throw new Error(`Equipment ledger lookup failed: ${error.message}`);
  return {
    equipment: equipmentResult.data,
    identifiers: identifiersResult.data ?? [],
    events: eventsResult.data ?? [],
    workLinks: workLinksResult.data ?? [],
    documentLinks: documentLinksResult.data ?? [],
  };
}

export async function getServiceCaseStateByNumber(orgId: string, caseNumber: string) {
  const admin = createAdminClient();
  const { data: serviceCase, error } = await admin
    .from('service_cases')
    .select('*')
    .eq('organization_id', orgId)
    .eq('case_number', caseNumber)
    .maybeSingle();
  if (error) {
    throw new Error(`Service case ${caseNumber} lookup failed: ${error.message}`);
  }
  if (!serviceCase) {
    throw new Error(`Service case ${caseNumber} not found in org ${orgId}`);
  }
  const [events, equipmentLinks, relations, evidenceLinks, documents, followUps] = await Promise.all([
    admin
      .from('service_case_events')
      .select('*')
      .eq('organization_id', orgId)
      .eq('service_case_id', serviceCase.id)
      .order('recorded_at'),
    admin
      .from('service_case_equipment_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('service_case_id', serviceCase.id),
    admin
      .from('service_case_relations')
      .select('*')
      .eq('organization_id', orgId)
      .or(`service_case_id.eq.${serviceCase.id},related_service_case_id.eq.${serviceCase.id}`),
    admin
      .from('service_case_evidence_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('service_case_id', serviceCase.id),
    admin
      .from('document_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('service_case_id', serviceCase.id),
    admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', orgId)
      .eq('source_type', 'service_case')
      .eq('source_id', serviceCase.id),
  ]);
  for (const result of [events, equipmentLinks, relations, evidenceLinks, documents, followUps]) {
    if (result.error) throw new Error(`Service case state lookup failed: ${result.error.message}`);
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

export async function getMaintenanceCoverageStateByReference(orgId: string, reference: string) {
  const admin = createAdminClient();
  const { data: coverage, error: coverageError } = await admin
    .from('maintenance_coverages')
    .select('*')
    .eq('organization_id', orgId)
    .eq('reference', reference)
    .maybeSingle();
  if (coverageError) {
    throw new Error(`Maintenance coverage lookup failed: ${coverageError.message}`);
  }
  if (!coverage) return null;
  const [events, documents, followUps] = await Promise.all([
    admin
      .from('maintenance_coverage_events')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_coverage_id', coverage.id)
      .order('recorded_at'),
    admin
      .from('document_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_coverage_id', coverage.id),
    admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', orgId)
      .eq('source_type', 'maintenance_coverage')
      .eq('source_id', coverage.id),
  ]);
  for (const result of [events, documents, followUps]) {
    if (result.error) {
      throw new Error(`Maintenance coverage state failed: ${result.error.message}`);
    }
  }
  return {
    coverage,
    events: events.data ?? [],
    documentLinks: documents.data ?? [],
    followUps: followUps.data ?? [],
  };
}

export async function getMaintenanceStateByPlanNumber(orgId: string, planNumber: string) {
  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from('maintenance_plans')
    .select('*')
    .eq('organization_id', orgId)
    .eq('plan_number', planNumber)
    .maybeSingle();
  if (error) throw new Error(`Maintenance plan lookup failed: ${error.message}`);
  if (!plan) return null;
  if (!plan.current_revision_id) {
    throw new Error(`Maintenance plan ${planNumber} has no current revision.`);
  }
  const dueWork = await admin
    .from('maintenance_due_work')
    .select('*')
    .eq('organization_id', orgId)
    .eq('maintenance_plan_id', plan.id)
    .order('due_date');
  if (dueWork.error) {
    throw new Error(`Maintenance state lookup failed: ${dueWork.error.message}`);
  }
  const dueWorkIds = (dueWork.data ?? []).map((due) => due.id);
  const [revisions, equipment, planEvents, dueEvents, evidenceLinks, serviceCaseLinks] = await Promise.all([
    admin
      .from('maintenance_plan_revisions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_plan_id', plan.id)
      .order('revision_number'),
    admin
      .from('maintenance_plan_revision_equipment')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_plan_revision_id', plan.current_revision_id),
    admin
      .from('maintenance_plan_events')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_plan_id', plan.id)
      .order('recorded_at'),
    dueWorkIds.length > 0
      ? admin
          .from('maintenance_due_work_events')
          .select('*')
          .eq('organization_id', orgId)
          .in('maintenance_due_work_id', dueWorkIds)
          .order('recorded_at')
      : Promise.resolve({ data: [], error: null }),
    dueWorkIds.length > 0
      ? admin
          .from('maintenance_due_evidence_links')
          .select('*')
          .eq('organization_id', orgId)
          .in('maintenance_due_work_id', dueWorkIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('maintenance_service_case_links')
      .select('*')
      .eq('organization_id', orgId)
      .eq('maintenance_plan_id', plan.id),
  ]);
  for (const result of [revisions, equipment, planEvents, dueEvents, evidenceLinks, serviceCaseLinks]) {
    if (result.error) {
      throw new Error(`Maintenance state lookup failed: ${result.error.message}`);
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
    .from('maintenance_plans')
    .select('plan_number')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Maintenance plan number lookup failed: ${error.message}`);
  return data?.plan_number ?? null;
}

export async function getMaintenancePlanNumbersByClient(orgId: string, clientId: string): Promise<string[]> {
  const admin = createAdminClient();
  // Oldest first, so a second plan for the same customer comes after the one it overlaps.
  const { data, error } = await admin
    .from('maintenance_plans')
    .select('plan_number')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at')
    .order('plan_number');
  if (error) throw new Error(`Maintenance plan lookup failed: ${error.message}`);
  return (data ?? []).map((plan) => plan.plan_number);
}
