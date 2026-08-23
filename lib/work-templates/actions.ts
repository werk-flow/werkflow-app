'use server'

import { revalidatePath, updateTag } from 'next/cache'

import { CACHE_TAGS } from '@/lib/data/cached'
import { authenticateAndAuthorize } from '@/lib/jobs/auth'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { loadAssignmentEvaluation } from '@/lib/qualifications/server'
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types'
import type { Json } from '@/lib/supabase/database.types'

import { createWorkTemplateSchema, workTemplateDraftSchema } from './schemas'
import {
  applyWorkTemplateWithAdmin,
  findUnavailableWorkTemplateReference,
  loadPublishedWorkTemplateOptions,
  loadWorkTemplateApplicationPreview,
  loadWorkTemplateDetail,
  loadWorkTemplateRequirementRows,
  loadWorkTemplateSummaries,
  toJson,
} from './server'
import type {
  ApplyWorkTemplateInput,
  PublishedWorkTemplateOption,
  WorkTemplateActionResult,
  WorkTemplateApplicationPreview,
  WorkTemplateDetail,
  WorkTemplateDraft,
  WorkTemplateSummary,
  WorkTemplateTargetType,
} from './types'

type WorkTemplateMutationResult = { success: true } | { success: false; error: string }
type ApplyWorkTemplateResult =
  | WorkTemplateActionResult<Json>
  | { success: false; error: string; evaluation: AssignmentEvaluation }
  | { success: false; error: string; referenceName: string | null }

function fail(error: string) {
  return { success: false as const, error }
}

function mapDatabaseError(message: string): string {
  if (['work_template_material_reference_unavailable', 'work_template_capability_reference_unavailable']
    .some((code) => message.includes(code))) return 'work_template_reference_unavailable'
  const known = [
    'work_template_dependency_cycle', 'work_template_dependency_self',
    'work_template_item_required',
    'work_template_version_unavailable', 'work_template_already_applied',
    'work_template_additional_confirmation_required', 'work_template_target_not_incomplete',
    'work_template_reference_unavailable', 'work_template_qualification_assessment_required',
  ]
  return known.find((code) => message.includes(code)) ?? 'operation_failed'
}

async function managerContext() {
  const auth = await authenticateAndAuthorize()
  if (!auth.success) return fail(auth.error)
  if (!auth.context.isManagerOrAbove) return fail('not_authorized')
  return { success: true as const, context: auth.context, admin: createSupabaseAdminClient() }
}

function refresh(organizationId: string) {
  updateTag(CACHE_TAGS.workTemplates(organizationId))
  updateTag(CACHE_TAGS.jobs(organizationId))
  updateTag(CACHE_TAGS.projects(organizationId))
  updateTag(CACHE_TAGS.inventory(organizationId))
  updateTag(CACHE_TAGS.qualifications(organizationId))
  revalidatePath('/arbeitsvorlagen')
  revalidatePath('/auftraege', 'layout')
}

export async function getWorkTemplates(): Promise<WorkTemplateActionResult<WorkTemplateSummary[]>> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    return { success: true as const, data: await loadWorkTemplateSummaries(result.context.orgId) }
  } catch (error) {
    console.error('Failed to load work templates:', error)
    return fail('load_failed')
  }
}

export async function getWorkTemplate(templateId: string): Promise<WorkTemplateActionResult<WorkTemplateDetail>> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    const template = await loadWorkTemplateDetail(result.context.orgId, templateId)
    return template ? { success: true as const, data: template } : fail('not_found')
  } catch (error) {
    console.error('Failed to load work template:', error)
    return fail('load_failed')
  }
}

export async function getPublishedWorkTemplates(
  targetType: WorkTemplateTargetType
): Promise<WorkTemplateActionResult<PublishedWorkTemplateOption[]>> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    return { success: true as const, data: await loadPublishedWorkTemplateOptions(result.context.orgId, targetType) }
  } catch (error) {
    console.error('Failed to load published work templates:', error)
    return fail('load_failed')
  }
}

export async function getWorkTemplatePreview(input: {
  versionId: string
  targetType: WorkTemplateTargetType
  jobId?: string
  projectId?: string
}): Promise<WorkTemplateActionResult<WorkTemplateApplicationPreview>> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    const preview = await loadWorkTemplateApplicationPreview({ organizationId: result.context.orgId, ...input })
    return preview ? { success: true as const, data: preview } : fail('not_found')
  } catch (error) {
    console.error('Failed to load work template preview:', error)
    return fail('load_failed')
  }
}

export async function createWorkTemplate(
  input: unknown
): Promise<WorkTemplateActionResult<{ templateId: string }>> {
  const parsed = createWorkTemplateSchema.safeParse(input)
  if (!parsed.success) return fail('validation_failed')
  const result = await managerContext()
  if (!result.success) return result
  try {
    const { data, error } = await result.admin.rpc('create_work_template', {
      p_organization_id: result.context.orgId,
      p_target_type: parsed.data.targetType,
      p_name: parsed.data.name,
      p_description: parsed.data.description ?? undefined,
      p_actor_id: result.context.userId,
    })
    if (error) {
      console.error('Failed to create work template:', error)
      return fail(mapDatabaseError(error.message))
    }
    refresh(result.context.orgId)
    return { success: true as const, data: { templateId: data } }
  } catch (error) {
    console.error('Failed to create work template:', error)
    return fail('operation_failed')
  }
}

export async function saveWorkTemplateDraft(input: {
  templateId: string
  draft: WorkTemplateDraft
}): Promise<WorkTemplateMutationResult> {
  const parsed = workTemplateDraftSchema.safeParse(input.draft)
  if (!parsed.success) return fail(parsed.error.issues.some((issue) => issue.message === 'dependency_cycle') ? 'work_template_dependency_cycle' : 'validation_failed')
  const result = await managerContext()
  if (!result.success) return result
  const draft = parsed.data
  try {
    const { error } = await result.admin.rpc('save_work_template_draft', {
      p_organization_id: result.context.orgId,
      p_template_id: input.templateId,
      p_actor_id: result.context.userId,
      p_name: draft.name,
      p_description: draft.description ?? undefined,
      p_items: toJson(draft.items.map((item) => ({ id: item.id, item_kind: item.itemKind, content: item.content, requirement_state: item.requirementState, group_label: item.groupLabel, notes: item.notes, sort_order: item.sortOrder }))),
      p_evidence: toJson(draft.evidence.map((item) => ({ id: item.id, template_item_id: item.templateItemId, description: item.description, document_category: item.documentCategory, sort_order: item.sortOrder }))),
      p_dependencies: toJson(draft.dependencies.map((item) => ({ id: item.id, predecessor_item_id: item.predecessorItemId, dependent_item_id: item.dependentItemId }))),
      p_materials: toJson(draft.materials.map((item) => ({ id: item.id, item_id: item.itemId, preferred_location_id: item.preferredLocationId, planned_quantity: item.plannedQuantity, is_billable: item.isBillable, notes: item.notes, sort_order: item.sortOrder }))),
      p_capabilities: toJson(draft.capabilities.map((item) => ({ id: item.id, capability_id: item.capabilityId, require_confirmation: item.requireConfirmation, sort_order: item.sortOrder }))),
    })
    if (error) {
      console.error('Failed to save work template draft:', error)
      return fail(mapDatabaseError(error.message))
    }
    refresh(result.context.orgId)
    return { success: true as const }
  } catch (error) {
    console.error('Failed to save work template:', error)
    return fail('operation_failed')
  }
}

async function simpleTemplateRpc(
  name: 'publish_work_template' | 'create_work_template_draft',
  templateId: string
): Promise<WorkTemplateActionResult<string>> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    const { data, error } = await result.admin.rpc(name, { p_organization_id: result.context.orgId, p_template_id: templateId, p_actor_id: result.context.userId })
    if (error) {
      console.error(`Failed to run ${name}:`, error)
      return fail(mapDatabaseError(error.message))
    }
    refresh(result.context.orgId)
    return { success: true as const, data }
  } catch (error) {
    console.error(`Failed to run ${name}:`, error)
    return fail('operation_failed')
  }
}

export async function publishWorkTemplate(
  templateId: string
): Promise<WorkTemplateActionResult<string>> {
  return simpleTemplateRpc('publish_work_template', templateId)
}

export async function createNextWorkTemplateDraft(
  templateId: string
): Promise<WorkTemplateActionResult<string>> {
  return simpleTemplateRpc('create_work_template_draft', templateId)
}

export async function setWorkTemplateArchived(
  templateId: string,
  archived: boolean
): Promise<WorkTemplateMutationResult> {
  const result = await managerContext()
  if (!result.success) return result
  try {
    const { error } = await result.admin.rpc('set_work_template_archived', { p_organization_id: result.context.orgId, p_template_id: templateId, p_actor_id: result.context.userId, p_archived: archived })
    if (error) {
      console.error('Failed to update work template archive state:', error)
      return fail(mapDatabaseError(error.message))
    }
    refresh(result.context.orgId)
    return { success: true as const }
  } catch (error) {
    console.error('Failed to update work template archive state:', error)
    return fail('operation_failed')
  }
}

export async function applyWorkTemplate(
  input: Omit<ApplyWorkTemplateInput, 'qualificationAssessment'> & {
    assignmentApproval?: AssignmentApproval | null
  }
): Promise<ApplyWorkTemplateResult> {
  const { assignmentApproval, ...applyInput } = input
  const result = await managerContext()
  if (!result.success) return result
  try {
    let qualificationAssessment: ApplyWorkTemplateInput['qualificationAssessment']
    if (input.jobId) {
      const [assignmentsResult, requirements] = await Promise.all([
        result.admin.from('job_assignments').select('user_id').eq('job_id', input.jobId).limit(201),
        loadWorkTemplateRequirementRows({ admin: result.admin, organizationId: result.context.orgId, versionId: input.templateVersionId, jobId: input.jobId }),
      ])
      if (assignmentsResult.error || !requirements.success || (assignmentsResult.data?.length ?? 0) > 200) return fail('load_failed')
      const evaluationResult = await loadAssignmentEvaluation({
        admin: result.admin,
        orgId: result.context.orgId,
        jobId: input.jobId,
        selectedUserIds: (assignmentsResult.data ?? []).map((row) => row.user_id),
        requirementRows: requirements.rows,
      })
      if (!evaluationResult.success) return evaluationResult
      const evaluation = evaluationResult.evaluation
      if (evaluation.requiresOverride) {
        if (!assignmentApproval) return { success: false as const, error: 'qualification_warning', evaluation }
        if (assignmentApproval.fingerprint !== evaluation.fingerprint) return { success: false as const, error: 'stale_evaluation', evaluation }
        if (assignmentApproval.reason.trim().length < 3) return { success: false as const, error: 'qualification_warning', evaluation }
      }
      if (requirements.templateRequirementCount > 0) {
        qualificationAssessment = {
          assessedForDate: evaluation.assessedForDate,
          selectedUserIds: evaluation.selectedUserIds,
          selectedEmployeeRecordIds: evaluation.selectedEmployeeRecordIds,
          requirementsSnapshot: toJson(evaluation.requirementCoverage),
          coverageSnapshot: toJson({ requirements: evaluation.requirementCoverage, apprentice_warning: evaluation.apprenticeWarning }),
          coverageFingerprint: evaluation.fingerprint,
          overrideReason: evaluation.requiresOverride ? assignmentApproval?.reason.trim() || null : null,
          teamSourceId: assignmentApproval?.teamSourceId ?? null,
        }
      }
    }
    const { data, error } = await applyWorkTemplateWithAdmin(result.admin, result.context.orgId, result.context.userId, { ...applyInput, qualificationAssessment })
    if (error) {
      const code = mapDatabaseError(error.message)
      if (code === 'work_template_reference_unavailable') {
        const referenceName = await findUnavailableWorkTemplateReference(result.admin, result.context.orgId, input.templateVersionId)
        return { success: false as const, error: code, referenceName }
      }
      return fail(code)
    }
    refresh(result.context.orgId)
    return { success: true as const, data }
  } catch (error) {
    console.error('Failed to apply work template:', error)
    return fail('operation_failed')
  }
}
