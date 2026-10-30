import type { ActionResult } from '@/lib/action-result';
import 'server-only';

import { cacheTag } from 'next/cache';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { CACHE_TAGS } from '@/lib/data/cached';
import { failCachedRead } from '@/lib/data/cached-read-failure';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { DOCUMENT_CATEGORIES } from '@/lib/documents/types';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { jsonRecordOrEmpty } from '@/lib/supabase/json';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { constrainedValue } from '@/lib/validation/constrained-value';

import {
  WORK_TEMPLATE_ITEM_KINDS,
  WORK_TEMPLATE_REQUIREMENT_STATES,
  WORK_TEMPLATE_TARGET_TYPES,
  WORK_TEMPLATE_VERSION_STATUSES,
  type ApplyWorkTemplateInput,
  type PublishedWorkTemplateOption,
  type WorkTemplateApplicationPreview,
  type WorkTemplateDetail,
  type WorkTemplateDraft,
  type WorkTemplateSummary,
  type WorkTemplateTargetType,
} from './types';

type TemplateRow = Pick<
  Database['public']['Tables']['work_templates']['Row'],
  'id' | 'target_type' | 'archived_at' | 'draft_version_id' | 'current_published_version_id' | 'updated_at'
>;
type VersionRow = Awaited<ReturnType<typeof loadVersions>>[number];
type VersionRows = Awaited<ReturnType<typeof readVersionRows>>;
type TemplateEvent = NonNullable<VersionRows[5]['data']>[number];
type HistoryLabels = {
  actorNames: Map<string, string>;
  versionNumbers: Map<string, number>;
  targetLabels: Map<string, string>;
};

function emptyDraft(name: string, description: string | null): WorkTemplateDraft {
  return { name, description, items: [], evidence: [], dependencies: [], materials: [], capabilities: [] };
}

async function loadVersions(admin: AdminClient, organizationId: string, versionIds: string[]) {
  const { data, error } = await readInBatches(versionIds, (batch) =>
    admin
      .from('work_template_versions')
      .select('id, template_id, version_number, status, name, description, updated_at')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (error) throw error;
  return data;
}

function toWorkTemplateSummary(template: TemplateRow, version: VersionRow): WorkTemplateSummary {
  return {
    id: template.id,
    targetType: constrainedValue(
      WORK_TEMPLATE_TARGET_TYPES,
      template.target_type,
      'work_templates.target_type',
    ),
    archivedAt: template.archived_at,
    draftVersionId: template.draft_version_id,
    currentPublishedVersionId: template.current_published_version_id,
    name: version.name,
    description: version.description,
    versionNumber: version.version_number,
    status: constrainedValue(WORK_TEMPLATE_VERSION_STATUSES, version.status, 'work_template_versions.status'),
    updatedAt: template.updated_at,
  };
}

/**
 * Cached across requests per organization; every template write updates the
 * tag. A failed read throws `CachedReadError`, so the cache stores nothing and
 * the next request reads again. The caller authorizes first.
 */
export async function loadWorkTemplateSummaries(organizationId: string): Promise<WorkTemplateSummary[]> {
  'use cache';
  cacheTag(CACHE_TAGS.workTemplates(organizationId));
  const admin = createSupabaseAdminClient();
  const { data: templates, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_templates')
        .select('id, target_type, archived_at, draft_version_id, current_published_version_id, updated_at')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) failCachedRead('work_templates_read_failed', error);
  const versionIds = Array.from(
    new Set(
      templates.flatMap((template) =>
        [template.draft_version_id, template.current_published_version_id].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    ),
  );
  const versions = await loadVersions(admin, organizationId, versionIds).catch((cause: unknown) =>
    failCachedRead('work_templates_read_failed', cause),
  );
  const byId = new Map(versions.map((version) => [version.id, version]));
  return templates.flatMap((template) => {
    const version =
      byId.get(template.draft_version_id ?? '') ?? byId.get(template.current_published_version_id ?? '');
    if (!version) return [];
    return [toWorkTemplateSummary(template, version)];
  });
}

export async function loadPublishedWorkTemplateOptions(
  organizationId: string,
  targetType: WorkTemplateTargetType,
): Promise<PublishedWorkTemplateOption[]> {
  const admin = createSupabaseAdminClient();
  const { data: templates, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_templates')
        .select('id, current_published_version_id')
        .eq('organization_id', organizationId)
        .eq('target_type', targetType)
        .is('archived_at', null)
        .not('current_published_version_id', 'is', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) throw new Error(`loadPublishedWorkTemplateOptions: ${error.message}`);
  const versions = await loadVersions(
    admin,
    organizationId,
    templates.flatMap((template) =>
      template.current_published_version_id ? [template.current_published_version_id] : [],
    ),
  );
  const templateByVersion = new Map(
    templates.map((template) => [template.current_published_version_id, template.id]),
  );
  return versions
    .map((version) => ({
      templateId: templateByVersion.get(version.id) ?? version.template_id,
      versionId: version.id,
      name: version.name,
      description: version.description,
      versionNumber: version.version_number,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

async function loadWorkTemplateSummary(
  admin: AdminClient,
  organizationId: string,
  templateId: string,
): Promise<WorkTemplateSummary | null> {
  const { data: template, error } = await admin
    .from('work_templates')
    .select('id, target_type, archived_at, draft_version_id, current_published_version_id, updated_at')
    .eq('organization_id', organizationId)
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw error;
  if (!template) return null;
  const versionIds = [template.draft_version_id, template.current_published_version_id].filter(
    (id): id is string => Boolean(id),
  );
  const versions = await loadVersions(admin, organizationId, versionIds);
  const byId = new Map(versions.map((version) => [version.id, version]));
  const version =
    byId.get(template.draft_version_id ?? '') ?? byId.get(template.current_published_version_id ?? '');
  if (!version) return null;
  return toWorkTemplateSummary(template, version);
}

async function readVersionRows(
  admin: AdminClient,
  organizationId: string,
  templateId: string,
  versionId: string,
) {
  const results = await Promise.all([
    admin
      .from('work_template_items')
      .select('id, item_kind, content, requirement_state, group_label, notes, sort_order')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .order('sort_order')
      .limit(200),
    admin
      .from('work_template_item_evidence_requirements')
      .select('id, template_item_id, description, document_category, sort_order')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .order('sort_order')
      .limit(500),
    admin
      .from('work_template_item_dependencies')
      .select('id, predecessor_item_id, dependent_item_id')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .limit(1000),
    admin
      .from('work_template_material_lines')
      .select('id, item_id, preferred_location_id, planned_quantity, is_billable, notes, sort_order')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .order('sort_order')
      .limit(500),
    admin
      .from('work_template_capability_requirements')
      .select('id, capability_id, require_confirmation, sort_order')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .order('sort_order')
      .limit(200),
    admin
      .from('work_template_events')
      .select('id, event_type, template_version_id, event_payload, actor_id, created_at')
      .eq('organization_id', organizationId)
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return results;
}

async function loadActorNames(admin: AdminClient, events: TemplateEvent[]): Promise<Map<string, string>> {
  const actorIds = Array.from(new Set(events.flatMap((event) => (event.actor_id ? [event.actor_id] : []))));
  const profilesResult = await readInBatches(actorIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) throw profilesResult.error;
  return new Map(
    profilesResult.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Unbekannt',
    ]),
  );
}

async function loadTargetLabels(
  admin: AdminClient,
  organizationId: string,
  events: TemplateEvent[],
): Promise<Map<string, string>> {
  const eventPayloads = events.map((event) => jsonRecordOrEmpty(event.event_payload));
  const jobIds = eventPayloads.flatMap((payload) =>
    typeof payload.jobId === 'string' ? [payload.jobId] : [],
  );
  const projectIds = eventPayloads.flatMap((payload) =>
    typeof payload.projectId === 'string' ? [payload.projectId] : [],
  );
  const [jobsResult, projectsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, project_number, name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (jobsResult.error) throw jobsResult.error;
  if (projectsResult.error) throw projectsResult.error;
  return new Map<string, string>([
    ...jobsResult.data.map((job) => [job.id, `${job.job_number} · ${job.title}`] as const),
    ...projectsResult.data.map(
      (project) => [project.id, `${project.project_number} · ${project.name}`] as const,
    ),
  ]);
}

async function loadHistoryLabels(
  admin: AdminClient,
  organizationId: string,
  events: TemplateEvent[],
): Promise<HistoryLabels> {
  const actorNames = await loadActorNames(admin, events);
  const eventVersionIds = Array.from(
    new Set(events.flatMap((event) => (event.template_version_id ? [event.template_version_id] : []))),
  );
  const eventVersions = await loadVersions(admin, organizationId, eventVersionIds);
  const versionNumbers = new Map(eventVersions.map((version) => [version.id, version.version_number]));
  const targetLabels = await loadTargetLabels(admin, organizationId, events);
  return { actorNames, versionNumbers, targetLabels };
}

function toDraft(summary: WorkTemplateSummary, rows: VersionRows): WorkTemplateDraft {
  const [itemsResult, evidenceResult, dependenciesResult, materialsResult, capabilitiesResult] = rows;
  return {
    name: summary.name,
    description: summary.description,
    items: (itemsResult.data ?? []).map((item) => ({
      id: item.id,
      itemKind: constrainedValue(WORK_TEMPLATE_ITEM_KINDS, item.item_kind, 'work_template_items.item_kind'),
      content: item.content,
      requirementState: constrainedValue(
        WORK_TEMPLATE_REQUIREMENT_STATES,
        item.requirement_state,
        'work_template_items.requirement_state',
      ),
      groupLabel: item.group_label,
      notes: item.notes,
      sortOrder: item.sort_order,
    })),
    evidence: (evidenceResult.data ?? []).map((item) => ({
      id: item.id,
      templateItemId: item.template_item_id,
      description: item.description,
      documentCategory: constrainedValue(
        DOCUMENT_CATEGORIES,
        item.document_category,
        'work_template_item_evidence_requirements.document_category',
      ),
      sortOrder: item.sort_order,
    })),
    dependencies: (dependenciesResult.data ?? []).map((item) => ({
      id: item.id,
      predecessorItemId: item.predecessor_item_id,
      dependentItemId: item.dependent_item_id,
    })),
    materials: (materialsResult.data ?? []).map((item) => ({
      id: item.id,
      itemId: item.item_id,
      preferredLocationId: item.preferred_location_id,
      plannedQuantity: Number(item.planned_quantity),
      isBillable: item.is_billable,
      notes: item.notes,
      sortOrder: item.sort_order,
    })),
    capabilities: (capabilitiesResult.data ?? []).map((item) => ({
      id: item.id,
      capabilityId: item.capability_id,
      requireConfirmation: item.require_confirmation,
      sortOrder: item.sort_order,
    })),
  };
}

function toHistory(events: TemplateEvent[], labels: HistoryLabels): WorkTemplateDetail['history'] {
  return events.map((event) => {
    const payload = jsonRecordOrEmpty(event.event_payload);
    const targetId =
      typeof payload.jobId === 'string'
        ? payload.jobId
        : typeof payload.projectId === 'string'
          ? payload.projectId
          : null;
    return {
      id: event.id,
      eventType: event.event_type,
      versionNumber: event.template_version_id
        ? (labels.versionNumbers.get(event.template_version_id) ?? null)
        : null,
      actorName: event.actor_id ? (labels.actorNames.get(event.actor_id) ?? 'Unbekannt') : 'System',
      targetLabel: targetId ? (labels.targetLabels.get(targetId) ?? 'Gelöschte Arbeit') : null,
      createdAt: event.created_at,
    };
  });
}

export async function loadWorkTemplateDetail(
  organizationId: string,
  templateId: string,
): Promise<WorkTemplateDetail | null> {
  const admin = createSupabaseAdminClient();
  const summary = await loadWorkTemplateSummary(admin, organizationId, templateId);
  if (!summary) return null;
  const versionId = summary.draftVersionId ?? summary.currentPublishedVersionId;
  if (!versionId) return { ...summary, draft: emptyDraft(summary.name, summary.description), history: [] };
  const rows = await readVersionRows(admin, organizationId, templateId, versionId);
  const events = rows[5].data ?? [];
  const labels = await loadHistoryLabels(admin, organizationId, events);
  return { ...summary, draft: toDraft(summary, rows), history: toHistory(events, labels) };
}

async function countVersionRows(
  admin: AdminClient,
  table:
    | 'work_template_items'
    | 'work_template_item_evidence_requirements'
    | 'work_template_item_dependencies'
    | 'work_template_material_lines'
    | 'work_template_capability_requirements',
  organizationId: string,
  versionId: string,
) {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('version_id', versionId);
  if (error) throw error;
  return count ?? 0;
}

export async function loadWorkTemplateApplicationPreview(input: {
  organizationId: string;
  targetType: WorkTemplateTargetType;
  versionId: string;
  jobId?: string;
  projectId?: string;
}): Promise<WorkTemplateApplicationPreview | null> {
  if (Number(Boolean(input.jobId)) + Number(Boolean(input.projectId)) !== 1) {
    throw new Error('Work-template preview requires exactly one target.');
  }
  const options = await loadPublishedWorkTemplateOptions(input.organizationId, input.targetType);
  const option = options.find((item) => item.versionId === input.versionId);
  if (!option) return null;
  const admin = createSupabaseAdminClient();
  const [itemCount, evidenceCount, dependencyCount, materialCount, capabilityCount, applications] =
    await Promise.all([
      countVersionRows(admin, 'work_template_items', input.organizationId, input.versionId),
      countVersionRows(
        admin,
        'work_template_item_evidence_requirements',
        input.organizationId,
        input.versionId,
      ),
      countVersionRows(admin, 'work_template_item_dependencies', input.organizationId, input.versionId),
      countVersionRows(admin, 'work_template_material_lines', input.organizationId, input.versionId),
      countVersionRows(admin, 'work_template_capability_requirements', input.organizationId, input.versionId),
      admin
        .from('work_template_applications')
        .select('template_version_id')
        .eq('organization_id', input.organizationId)
        .eq(input.jobId ? 'job_id' : 'project_id', input.jobId ?? input.projectId ?? '')
        .limit(100),
    ]);
  if (applications.error) throw applications.error;
  return {
    ...option,
    itemCount,
    evidenceCount,
    dependencyCount,
    materialCount,
    capabilityCount,
    hasExistingApplication: (applications.data ?? []).length > 0,
    hasSameVersionApplication: (applications.data ?? []).some(
      (item) => item.template_version_id === input.versionId,
    ),
  };
}

export async function applyWorkTemplateWithAdmin(
  admin: AdminClient,
  organizationId: string,
  actorId: string,
  input: ApplyWorkTemplateInput,
): Promise<PostgrestSingleResponse<Json>> {
  const assessment = input.qualificationAssessment;
  return admin.rpc('apply_work_template', {
    p_organization_id: organizationId,
    p_template_version_id: input.templateVersionId,
    p_actor_id: actorId,
    p_idempotency_key: input.idempotencyKey,
    ...(input.jobId !== undefined ? { p_job_id: input.jobId } : {}),
    ...(input.projectId !== undefined ? { p_project_id: input.projectId } : {}),
    p_allow_additional: input.allowAdditional ?? false,
    ...(assessment
      ? {
          p_assessed_for_date: assessment.assessedForDate,
          p_selected_user_ids: assessment.selectedUserIds,
          p_selected_employee_record_ids: assessment.selectedEmployeeRecordIds,
          p_requirements_snapshot: assessment.requirementsSnapshot,
          p_coverage_snapshot: assessment.coverageSnapshot,
          p_coverage_fingerprint: assessment.coverageFingerprint,
          ...(assessment.overrideReason !== null ? { p_override_reason: assessment.overrideReason } : {}),
          ...(assessment.teamSourceId !== null ? { p_team_source_id: assessment.teamSourceId } : {}),
        }
      : {}),
  });
}

export async function findUnavailableWorkTemplateReference(
  admin: AdminClient,
  organizationId: string,
  versionId: string,
): Promise<string | null> {
  const [materialsResult, capabilitiesResult] = await Promise.all([
    admin
      .from('work_template_material_lines')
      .select('item_id, preferred_location_id')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .limit(500),
    admin
      .from('work_template_capability_requirements')
      .select('capability_id')
      .eq('organization_id', organizationId)
      .eq('version_id', versionId)
      .limit(200),
  ]);
  if (materialsResult.error) throw materialsResult.error;
  if (capabilitiesResult.error) throw capabilitiesResult.error;
  const itemIds = (materialsResult.data ?? []).map((row) => row.item_id);
  const locationIds = (materialsResult.data ?? []).flatMap((row) =>
    row.preferred_location_id ? [row.preferred_location_id] : [],
  );
  const capabilityIds = (capabilitiesResult.data ?? []).map((row) => row.capability_id);
  const [items, locations, capabilities] = await Promise.all([
    readInBatches(itemIds, (batch) =>
      admin
        .from('inventory_items')
        .select('id, name, is_active')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(locationIds, (batch) =>
      admin
        .from('inventory_locations')
        .select('id, name, is_active')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(capabilityIds, (batch) =>
      admin
        .from('organization_capabilities')
        .select('id, name, retired_at')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (items.error) throw items.error;
  if (locations.error) throw locations.error;
  if (capabilities.error) throw capabilities.error;
  const itemById = new Map(items.data.map((row) => [row.id, row]));
  const locationById = new Map(locations.data.map((row) => [row.id, row]));
  const capabilityById = new Map(capabilities.data.map((row) => [row.id, row]));
  for (const itemId of itemIds) {
    const item = itemById.get(itemId);
    if (!item || !item.is_active) return item?.name ?? 'Gelöschter Artikel';
  }
  for (const locationId of locationIds) {
    const location = locationById.get(locationId);
    if (!location || !location.is_active) return location?.name ?? 'Gelöschtes Lager';
  }
  for (const capabilityId of capabilityIds) {
    const capability = capabilityById.get(capabilityId);
    if (!capability || capability.retired_at) return capability?.name ?? 'Gelöschte Qualifikation';
  }
  return null;
}

export async function loadWorkTemplateRequirementRows(input: {
  admin: AdminClient;
  organizationId: string;
  versionId: string;
  jobId?: string;
}): Promise<
  ActionResult<{
    rows: Array<{ id: string; capability_id: string; require_confirmation: boolean }>;
    templateRequirementCount: number;
  }>
> {
  const [templateResult, jobResult] = await Promise.all([
    input.admin
      .from('work_template_capability_requirements')
      .select('id, capability_id, require_confirmation')
      .eq('organization_id', input.organizationId)
      .eq('version_id', input.versionId)
      .order('sort_order')
      .limit(201),
    input.jobId
      ? input.admin
          .from('job_capability_requirements')
          .select('id, capability_id, require_confirmation')
          .eq('organization_id', input.organizationId)
          .eq('job_id', input.jobId)
          .order('created_at')
          .limit(201)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const requirementError = templateResult.error ?? jobResult.error;
  if (requirementError) {
    logReadFailure('loadWorkTemplateRequirementRows: requirement read failed', {
      code: requirementError.code,
      message: requirementError.message,
    });
    return { success: false as const, error: 'load_failed' };
  }
  if ((templateResult.data?.length ?? 0) > 200 || (jobResult.data?.length ?? 0) > 200) {
    logReadFailure('loadWorkTemplateRequirementRows: more than 200 requirements', {
      code: 'requirement_overflow',
      versionId: input.versionId,
      jobId: input.jobId ?? null,
    });
    return { success: false as const, error: 'load_failed' };
  }
  const merged = new Map<string, { id: string; capability_id: string; require_confirmation: boolean }>();
  for (const row of [...(jobResult.data ?? []), ...(templateResult.data ?? [])]) {
    const current = merged.get(row.capability_id);
    merged.set(
      row.capability_id,
      current
        ? { ...current, require_confirmation: current.require_confirmation || row.require_confirmation }
        : row,
    );
  }
  return {
    success: true as const,
    rows: [...merged.values()],
    templateRequirementCount: templateResult.data?.length ?? 0,
  };
}
