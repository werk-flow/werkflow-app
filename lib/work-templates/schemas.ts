import { z } from 'zod'
import { uuidSchema } from '@/lib/validation/uuid'

const uuid = uuidSchema
const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional().transform((value) => value || null)

const itemSchema = z.object({
  id: uuid,
  itemKind: z.enum(['task', 'checklist']),
  content: z.string().trim().min(1).max(1000),
  requirementState: z.enum(['required', 'optional']),
  groupLabel: nullableText(120),
  notes: nullableText(2000),
  sortOrder: z.number().int().nonnegative(),
})

export const workTemplateDraftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: nullableText(2000),
  items: z.array(itemSchema).max(200),
  evidence: z.array(z.object({
    id: uuid,
    templateItemId: uuid,
    description: z.string().trim().min(1).max(500),
    documentCategory: z.enum(['photo', 'contract', 'invoice', 'offer', 'report', 'other']),
    sortOrder: z.number().int().nonnegative(),
  })).max(500),
  dependencies: z.array(z.object({
    id: uuid,
    predecessorItemId: uuid,
    dependentItemId: uuid,
  })).max(1000),
  materials: z.array(z.object({
    id: uuid,
    itemId: uuid,
    preferredLocationId: uuid.nullable(),
    plannedQuantity: z.number().positive().max(999999999),
    isBillable: z.boolean(),
    notes: nullableText(1000),
    sortOrder: z.number().int().nonnegative(),
  })).max(500),
  capabilities: z.array(z.object({
    id: uuid,
    capabilityId: uuid,
    requireConfirmation: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })).max(200),
}).superRefine((draft, context) => {
  function validateUnique<T>(
    values: T[],
    key: (value: T) => string,
    collection: string,
    message: string
  ): void {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      const candidate = key(value)
      if (seen.has(candidate)) {
        context.addIssue({ code: 'custom', message, path: [collection, index] })
      }
      seen.add(candidate)
    })
  }

  validateUnique(draft.items, (item) => item.id, 'items', 'duplicate_item')
  validateUnique(draft.items, (item) => String(item.sortOrder), 'items', 'duplicate_sort_order')
  validateUnique(draft.evidence, (item) => item.id, 'evidence', 'duplicate_evidence')
  validateUnique(draft.evidence, (item) => `${item.templateItemId}:${item.sortOrder}`, 'evidence', 'duplicate_sort_order')
  validateUnique(draft.dependencies, (item) => item.id, 'dependencies', 'duplicate_dependency')
  validateUnique(draft.dependencies, (item) => `${item.predecessorItemId}:${item.dependentItemId}`, 'dependencies', 'duplicate_dependency')
  validateUnique(draft.materials, (item) => item.id, 'materials', 'duplicate_material')
  validateUnique(draft.materials, (item) => String(item.sortOrder), 'materials', 'duplicate_sort_order')
  validateUnique(draft.capabilities, (item) => item.id, 'capabilities', 'duplicate_capability')
  validateUnique(draft.capabilities, (item) => item.capabilityId, 'capabilities', 'duplicate_capability')
  validateUnique(draft.capabilities, (item) => String(item.sortOrder), 'capabilities', 'duplicate_sort_order')

  const itemIds = new Set(draft.items.map((item) => item.id))
  draft.evidence.forEach((evidence, index) => {
    if (!itemIds.has(evidence.templateItemId)) context.addIssue({ code: 'custom', message: 'evidence_item_missing', path: ['evidence', index] })
  })
  const edges = new Map<string, string[]>()
  draft.dependencies.forEach((dependency, index) => {
    if (!itemIds.has(dependency.predecessorItemId) || !itemIds.has(dependency.dependentItemId)) {
      context.addIssue({ code: 'custom', message: 'dependency_item_missing', path: ['dependencies', index] })
      return
    }
    if (dependency.predecessorItemId === dependency.dependentItemId) {
      context.addIssue({ code: 'custom', message: 'dependency_self', path: ['dependencies', index] })
    }
    edges.set(dependency.predecessorItemId, [...(edges.get(dependency.predecessorItemId) ?? []), dependency.dependentItemId])
  })
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cyclic = (edges.get(id) ?? []).some(hasCycle)
    visiting.delete(id)
    visited.add(id)
    return cyclic
  }
  if (draft.items.some((item) => hasCycle(item.id))) {
    context.addIssue({ code: 'custom', message: 'dependency_cycle' })
  }
})

export const createWorkTemplateSchema = z.object({
  targetType: z.enum(['job', 'project']),
  name: z.string().trim().min(1).max(160),
  description: nullableText(2000),
})
