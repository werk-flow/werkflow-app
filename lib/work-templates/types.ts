import type { Json } from '@/lib/supabase/database.types'

export type WorkTemplateTargetType = 'job' | 'project'
type WorkTemplateItemKind = 'task' | 'checklist'
type WorkTemplateRequirementState = 'required' | 'optional'
type WorkTemplateDocumentCategory =
  | 'photo'
  | 'contract'
  | 'invoice'
  | 'offer'
  | 'report'
  | 'other'

type WorkTemplateItemDraft = {
  id: string
  itemKind: WorkTemplateItemKind
  content: string
  requirementState: WorkTemplateRequirementState
  groupLabel: string | null
  notes: string | null
  sortOrder: number
}

type WorkTemplateEvidenceDraft = {
  id: string
  templateItemId: string
  description: string
  documentCategory: WorkTemplateDocumentCategory
  sortOrder: number
}

type WorkTemplateDependencyDraft = {
  id: string
  predecessorItemId: string
  dependentItemId: string
}

type WorkTemplateMaterialDraft = {
  id: string
  itemId: string
  preferredLocationId: string | null
  plannedQuantity: number
  isBillable: boolean
  notes: string | null
  sortOrder: number
}

type WorkTemplateCapabilityDraft = {
  id: string
  capabilityId: string
  requireConfirmation: boolean
  sortOrder: number
}

export type WorkTemplateDraft = {
  name: string
  description: string | null
  items: WorkTemplateItemDraft[]
  evidence: WorkTemplateEvidenceDraft[]
  dependencies: WorkTemplateDependencyDraft[]
  materials: WorkTemplateMaterialDraft[]
  capabilities: WorkTemplateCapabilityDraft[]
}

export type WorkTemplateSummary = {
  id: string
  targetType: WorkTemplateTargetType
  archivedAt: string | null
  draftVersionId: string | null
  currentPublishedVersionId: string | null
  name: string
  description: string | null
  versionNumber: number
  status: 'draft' | 'published'
  updatedAt: string
}

export type PublishedWorkTemplateOption = {
  templateId: string
  versionId: string
  name: string
  description: string | null
  versionNumber: number
}

export type WorkTemplateApplicationPreview = PublishedWorkTemplateOption & {
  itemCount: number
  evidenceCount: number
  materialCount: number
  capabilityCount: number
  dependencyCount: number
  hasExistingApplication: boolean
  hasSameVersionApplication: boolean
}

type WorkTemplateEvent = {
  id: string
  eventType: string
  versionNumber: number | null
  actorName: string
  targetLabel: string | null
  createdAt: string
}

export type WorkTemplateDetail = WorkTemplateSummary & {
  draft: WorkTemplateDraft
  history: WorkTemplateEvent[]
}

export type WorkTemplateActionResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string }

export type ApplyWorkTemplateInput = {
  templateVersionId: string
  jobId?: string
  projectId?: string
  allowAdditional?: boolean
  idempotencyKey: string
  qualificationAssessment?: {
    assessedForDate: string
    selectedUserIds: string[]
    selectedEmployeeRecordIds: string[]
    requirementsSnapshot: Json
    coverageSnapshot: Json
    coverageFingerprint: string
    overrideReason: string | null
    teamSourceId: string | null
  } | undefined
}
