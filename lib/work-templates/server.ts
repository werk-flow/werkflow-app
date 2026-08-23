import 'server-only'

import { cacheTag } from 'next/cache'

import { CACHE_TAGS } from '@/lib/data/cached'
import { authenticateAndAuthorize } from '@/lib/jobs/auth'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'

import type {
  ApplyWorkTemplateInput,
  PublishedWorkTemplateOption,
  WorkTemplateApplicationPreview,
  WorkTemplateDetail,
  WorkTemplateDraft,
  WorkTemplateSummary,
  WorkTemplateTargetType,
} from './types'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

function emptyDraft(name: string, description: string | null): WorkTemplateDraft {
  return { name, description, items: [], evidence: [], dependencies: [], materials: [], capabilities: [] }
}

async function loadVersions(
  admin: AdminClient,
  organizationId: string,
  versionIds: string[]
) {
  if (versionIds.length === 0) return []
  const { data, error } = await admin
    .from('work_template_versions')
    .select('id, template_id, version_number, status, name, description, updated_at')
    .eq('organization_id', organizationId)
    .in('id', versionIds)
  if (error) throw error
  return data ?? []
}

export async function loadWorkTemplateSummaries(
  organizationId: string
): Promise<WorkTemplateSummary[]> {
  'use cache'
  cacheTag(CACHE_TAGS.workTemplates(organizationId))
  const admin = createSupabaseAdminClient()
  const { data: templates, error } = await admin
    .from('work_templates')
    .select('id, target_type, archived_at, draft_version_id, current_published_version_id, updated_at')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) throw error
  const versionIds = Array.from(new Set((templates ?? []).flatMap((template) =>
    [template.draft_version_id, template.current_published_version_id].filter((id): id is string => Boolean(id))
  )))
  const versions = await loadVersions(admin, organizationId, versionIds)
  const byId = new Map(versions.map((version) => [version.id, version]))
  return (templates ?? []).flatMap((template) => {
    const version = byId.get(template.draft_version_id ?? '') ?? byId.get(template.current_published_version_id ?? '')
    if (!version) return []
    return [{
      id: template.id,
      targetType: template.target_type as WorkTemplateTargetType,
      archivedAt: template.archived_at,
      draftVersionId: template.draft_version_id,
      currentPublishedVersionId: template.current_published_version_id,
      name: version.name,
      description: version.description,
      versionNumber: version.version_number,
      status: version.status as 'draft' | 'published',
      updatedAt: template.updated_at,
    }]
  })
}

export async function loadPublishedWorkTemplateOptions(
  organizationId: string,
  targetType: WorkTemplateTargetType
): Promise<PublishedWorkTemplateOption[]> {
  const admin = createSupabaseAdminClient()
  const { data: templates, error } = await admin
    .from('work_templates')
    .select('id, current_published_version_id')
    .eq('organization_id', organizationId)
    .eq('target_type', targetType)
    .is('archived_at', null)
    .not('current_published_version_id', 'is', null)
    .limit(500)
  if (error) throw error
  const versions = await loadVersions(
    admin,
    organizationId,
    (templates ?? []).flatMap((template) => template.current_published_version_id ? [template.current_published_version_id] : [])
  )
  const templateByVersion = new Map((templates ?? []).map((template) => [template.current_published_version_id, template.id]))
  return versions
    .map((version) => ({
      templateId: templateByVersion.get(version.id) ?? version.template_id,
      versionId: version.id,
      name: version.name,
      description: version.description,
      versionNumber: version.version_number,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

async function loadWorkTemplateSummary(
  admin: AdminClient,
  organizationId: string,
  templateId: string
): Promise<WorkTemplateSummary | null> {
  const { data: template, error } = await admin
    .from('work_templates')
    .select('id, target_type, archived_at, draft_version_id, current_published_version_id, updated_at')
    .eq('organization_id', organizationId)
    .eq('id', templateId)
    .maybeSingle()
  if (error) throw error
  if (!template) return null
  const versionIds = [template.draft_version_id, template.current_published_version_id].filter((id): id is string => Boolean(id))
  const versions = await loadVersions(admin, organizationId, versionIds)
  const byId = new Map(versions.map((version) => [version.id, version]))
  const version = byId.get(template.draft_version_id ?? '') ?? byId.get(template.current_published_version_id ?? '')
  if (!version) return null
  return {
    id: template.id,
    targetType: template.target_type as WorkTemplateTargetType,
    archivedAt: template.archived_at,
    draftVersionId: template.draft_version_id,
    currentPublishedVersionId: template.current_published_version_id,
    name: version.name,
    description: version.description,
    versionNumber: version.version_number,
    status: version.status as 'draft' | 'published',
    updatedAt: template.updated_at,
  }
}

export async function loadWorkTemplateDetail(
  organizationId: string,
  templateId: string
): Promise<WorkTemplateDetail | null> {
  const admin = createSupabaseAdminClient()
  const summary = await loadWorkTemplateSummary(admin, organizationId, templateId)
  if (!summary) return null
  const versionId = summary.draftVersionId ?? summary.currentPublishedVersionId
  if (!versionId) return { ...summary, draft: emptyDraft(summary.name, summary.description), history: [] }

  const [itemsResult, evidenceResult, dependenciesResult, materialsResult, capabilitiesResult, eventsResult] = await Promise.all([
    admin.from('work_template_items').select('id, item_kind, content, requirement_state, group_label, notes, sort_order').eq('organization_id', organizationId).eq('version_id', versionId).order('sort_order').limit(200),
    admin.from('work_template_item_evidence_requirements').select('id, template_item_id, description, document_category, sort_order').eq('organization_id', organizationId).eq('version_id', versionId).order('sort_order').limit(500),
    admin.from('work_template_item_dependencies').select('id, predecessor_item_id, dependent_item_id').eq('organization_id', organizationId).eq('version_id', versionId).limit(1000),
    admin.from('work_template_material_lines').select('id, item_id, preferred_location_id, planned_quantity, is_billable, notes, sort_order').eq('organization_id', organizationId).eq('version_id', versionId).order('sort_order').limit(500),
    admin.from('work_template_capability_requirements').select('id, capability_id, require_confirmation, sort_order').eq('organization_id', organizationId).eq('version_id', versionId).order('sort_order').limit(200),
    admin.from('work_template_events').select('id, event_type, template_version_id, event_payload, actor_id, created_at').eq('organization_id', organizationId).eq('template_id', templateId).order('created_at', { ascending: false }).limit(200),
  ])
  const failed = [itemsResult, evidenceResult, dependenciesResult, materialsResult, capabilitiesResult, eventsResult].find((result) => result.error)
  if (failed?.error) throw failed.error

  const actorIds = Array.from(new Set((eventsResult.data ?? []).flatMap((event) => event.actor_id ? [event.actor_id] : [])))
  const profilesResult = actorIds.length
    ? await admin.from('profiles').select('id, first_name, last_name, email').in('id', actorIds)
    : { data: [], error: null }
  if (profilesResult.error) throw profilesResult.error
  const actorNames = new Map((profilesResult.data ?? []).map((profile) => [
    profile.id,
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Unbekannt',
  ]))
  const eventVersionIds = Array.from(new Set((eventsResult.data ?? []).flatMap((event) => event.template_version_id ? [event.template_version_id] : [])))
  const eventVersions = await loadVersions(admin, organizationId, eventVersionIds)
  const versionNumbers = new Map(eventVersions.map((version) => [version.id, version.version_number]))
  const eventPayloads = (eventsResult.data ?? []).map((event) => event.event_payload as Record<string, unknown>)
  const jobIds = eventPayloads.flatMap((payload) => typeof payload.jobId === 'string' ? [payload.jobId] : [])
  const projectIds = eventPayloads.flatMap((payload) => typeof payload.projectId === 'string' ? [payload.projectId] : [])
  const [jobsResult, projectsResult] = await Promise.all([
    jobIds.length ? admin.from('jobs').select('id, job_number, title').eq('organization_id', organizationId).in('id', jobIds).limit(200) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? admin.from('projects').select('id, project_number, name').eq('organization_id', organizationId).in('id', projectIds).limit(200) : Promise.resolve({ data: [], error: null }),
  ])
  if (jobsResult.error) throw jobsResult.error
  if (projectsResult.error) throw projectsResult.error
  const targetLabels = new Map<string, string>([
    ...(jobsResult.data ?? []).map((job) => [job.id, `${job.job_number} · ${job.title}`] as const),
    ...(projectsResult.data ?? []).map((project) => [project.id, `${project.project_number} · ${project.name}`] as const),
  ])

  return {
    ...summary,
    draft: {
      name: summary.name,
      description: summary.description,
      items: (itemsResult.data ?? []).map((item) => ({ id: item.id, itemKind: item.item_kind as 'task' | 'checklist', content: item.content, requirementState: item.requirement_state as 'required' | 'optional', groupLabel: item.group_label, notes: item.notes, sortOrder: item.sort_order })),
      evidence: (evidenceResult.data ?? []).map((item) => ({ id: item.id, templateItemId: item.template_item_id, description: item.description, documentCategory: item.document_category as WorkTemplateDraft['evidence'][number]['documentCategory'], sortOrder: item.sort_order })),
      dependencies: (dependenciesResult.data ?? []).map((item) => ({ id: item.id, predecessorItemId: item.predecessor_item_id, dependentItemId: item.dependent_item_id })),
      materials: (materialsResult.data ?? []).map((item) => ({ id: item.id, itemId: item.item_id, preferredLocationId: item.preferred_location_id, plannedQuantity: Number(item.planned_quantity), isBillable: item.is_billable, notes: item.notes, sortOrder: item.sort_order })),
      capabilities: (capabilitiesResult.data ?? []).map((item) => ({ id: item.id, capabilityId: item.capability_id, requireConfirmation: item.require_confirmation, sortOrder: item.sort_order })),
    },
    history: (eventsResult.data ?? []).map((event) => {
      const payload = event.event_payload as Record<string, unknown>
      const targetId = typeof payload.jobId === 'string' ? payload.jobId : typeof payload.projectId === 'string' ? payload.projectId : null
      return {
        id: event.id,
        eventType: event.event_type,
        versionNumber: event.template_version_id ? versionNumbers.get(event.template_version_id) ?? null : null,
        actorName: event.actor_id ? actorNames.get(event.actor_id) ?? 'Unbekannt' : 'System',
        targetLabel: targetId ? targetLabels.get(targetId) ?? 'Gelöschte Arbeit' : null,
        createdAt: event.created_at,
      }
    }),
  }
}

async function countVersionRows(admin: AdminClient, table: 'work_template_items' | 'work_template_item_evidence_requirements' | 'work_template_item_dependencies' | 'work_template_material_lines' | 'work_template_capability_requirements', organizationId: string, versionId: string) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('version_id', versionId)
  if (error) throw error
  return count ?? 0
}

export async function loadWorkTemplateApplicationPreview(input: {
  organizationId: string
  targetType: WorkTemplateTargetType
  versionId: string
  jobId?: string
  projectId?: string
}): Promise<WorkTemplateApplicationPreview | null> {
  if (Number(Boolean(input.jobId)) + Number(Boolean(input.projectId)) !== 1) {
    throw new Error('Work-template preview requires exactly one target.')
  }
  const options = await loadPublishedWorkTemplateOptions(input.organizationId, input.targetType)
  const option = options.find((item) => item.versionId === input.versionId)
  if (!option) return null
  const admin = createSupabaseAdminClient()
  const [itemCount, evidenceCount, dependencyCount, materialCount, capabilityCount, applications] = await Promise.all([
    countVersionRows(admin, 'work_template_items', input.organizationId, input.versionId),
    countVersionRows(admin, 'work_template_item_evidence_requirements', input.organizationId, input.versionId),
    countVersionRows(admin, 'work_template_item_dependencies', input.organizationId, input.versionId),
    countVersionRows(admin, 'work_template_material_lines', input.organizationId, input.versionId),
    countVersionRows(admin, 'work_template_capability_requirements', input.organizationId, input.versionId),
    admin.from('work_template_applications').select('template_version_id').eq('organization_id', input.organizationId).eq(input.jobId ? 'job_id' : 'project_id', input.jobId ?? input.projectId ?? '').limit(100),
  ])
  if (applications.error) throw applications.error
  return {
    ...option,
    itemCount,
    evidenceCount,
    dependencyCount,
    materialCount,
    capabilityCount,
    hasExistingApplication: (applications.data ?? []).length > 0,
    hasSameVersionApplication: (applications.data ?? []).some((item) => item.template_version_id === input.versionId),
  }
}

export async function applyWorkTemplateWithAdmin(
  admin: AdminClient,
  organizationId: string,
  actorId: string,
  input: ApplyWorkTemplateInput
) {
  const assessment = input.qualificationAssessment
  return admin.rpc('apply_work_template', {
    p_organization_id: organizationId,
    p_template_version_id: input.templateVersionId,
    p_actor_id: actorId,
    p_idempotency_key: input.idempotencyKey,
    p_job_id: input.jobId,
    p_project_id: input.projectId,
    p_allow_additional: input.allowAdditional ?? false,
    p_assessed_for_date: assessment?.assessedForDate,
    p_selected_user_ids: assessment?.selectedUserIds,
    p_selected_employee_record_ids: assessment?.selectedEmployeeRecordIds,
    p_requirements_snapshot: assessment?.requirementsSnapshot,
    p_coverage_snapshot: assessment?.coverageSnapshot,
    p_coverage_fingerprint: assessment?.coverageFingerprint,
    p_override_reason: assessment?.overrideReason ?? undefined,
    p_team_source_id: assessment?.teamSourceId ?? undefined,
  })
}

export async function findUnavailableWorkTemplateReference(
  admin: AdminClient,
  organizationId: string,
  versionId: string
): Promise<string | null> {
  const [materialsResult, capabilitiesResult] = await Promise.all([
    admin.from('work_template_material_lines').select('item_id, preferred_location_id').eq('organization_id', organizationId).eq('version_id', versionId).limit(500),
    admin.from('work_template_capability_requirements').select('capability_id').eq('organization_id', organizationId).eq('version_id', versionId).limit(200),
  ])
  if (materialsResult.error) throw materialsResult.error
  if (capabilitiesResult.error) throw capabilitiesResult.error
  const itemIds = (materialsResult.data ?? []).map((row) => row.item_id)
  const locationIds = (materialsResult.data ?? []).flatMap((row) => row.preferred_location_id ? [row.preferred_location_id] : [])
  const capabilityIds = (capabilitiesResult.data ?? []).map((row) => row.capability_id)
  const [items, locations, capabilities] = await Promise.all([
    itemIds.length ? admin.from('inventory_items').select('id, name, is_active').eq('organization_id', organizationId).in('id', itemIds).limit(500) : Promise.resolve({ data: [], error: null }),
    locationIds.length ? admin.from('inventory_locations').select('id, name, is_active').eq('organization_id', organizationId).in('id', locationIds).limit(500) : Promise.resolve({ data: [], error: null }),
    capabilityIds.length ? admin.from('organization_capabilities').select('id, name, retired_at').eq('organization_id', organizationId).in('id', capabilityIds).limit(200) : Promise.resolve({ data: [], error: null }),
  ])
  if (items.error) throw items.error
  if (locations.error) throw locations.error
  if (capabilities.error) throw capabilities.error
  const itemById = new Map((items.data ?? []).map((row) => [row.id, row]))
  const locationById = new Map((locations.data ?? []).map((row) => [row.id, row]))
  const capabilityById = new Map((capabilities.data ?? []).map((row) => [row.id, row]))
  for (const itemId of itemIds) {
    const item = itemById.get(itemId)
    if (!item || !item.is_active) return item?.name ?? 'Gelöschter Artikel'
  }
  for (const locationId of locationIds) {
    const location = locationById.get(locationId)
    if (!location || !location.is_active) return location?.name ?? 'Gelöschtes Lager'
  }
  for (const capabilityId of capabilityIds) {
    const capability = capabilityById.get(capabilityId)
    if (!capability || capability.retired_at) return capability?.name ?? 'Gelöschte Qualifikation'
  }
  return null
}

export async function loadWorkTemplateRequirementRows(input: {
  admin: AdminClient
  organizationId: string
  versionId: string
  jobId?: string
}) {
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
  ])
  if (templateResult.error || jobResult.error) return { success: false as const, error: 'load_failed' }
  if ((templateResult.data?.length ?? 0) > 200 || (jobResult.data?.length ?? 0) > 200) {
    return { success: false as const, error: 'load_failed' }
  }
  const merged = new Map<string, { id: string; capability_id: string; require_confirmation: boolean }>()
  for (const row of [...(jobResult.data ?? []), ...(templateResult.data ?? [])]) {
    const current = merged.get(row.capability_id)
    merged.set(row.capability_id, current
      ? { ...current, require_confirmation: current.require_confirmation || row.require_confirmation }
      : row)
  }
  return { success: true as const, rows: [...merged.values()], templateRequirementCount: templateResult.data?.length ?? 0 }
}

export async function getManagerWorkTemplateContext() {
  const auth = await authenticateAndAuthorize()
  if (!auth.success || !auth.context.isManagerOrAbove) return null
  return auth.context
}

export function toJson(value: unknown): Json {
  return value as Json
}
