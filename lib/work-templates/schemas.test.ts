import { describe, expect, test } from 'bun:test'

import { workTemplateDraftSchema } from './schemas'

const firstId = '00000000-0000-4000-8000-000000000001'
const secondId = '00000000-0000-4000-8000-000000000002'
const thirdId = '00000000-0000-4000-8000-000000000003'

function draft() {
  return {
    name: 'Heizungswartung',
    description: 'Wiederkehrende Wartung',
    items: [
      { id: firstId, itemKind: 'task', content: 'Anlage prüfen', requirementState: 'required', groupLabel: 'Prüfung', notes: null, sortOrder: 0 },
      { id: secondId, itemKind: 'checklist', content: 'Messwerte notieren', requirementState: 'optional', groupLabel: null, notes: 'Herstellerangaben beachten', sortOrder: 1 },
    ],
    evidence: [{ id: thirdId, templateItemId: secondId, description: 'Foto der Messwerte', documentCategory: 'photo', sortOrder: 0 }],
    dependencies: [{ id: thirdId, predecessorItemId: firstId, dependentItemId: secondId }],
    materials: [],
    capabilities: [],
  } as const
}

describe('workTemplateDraftSchema', () => {
  test('accepts a bounded draft containing tasks, evidence, and dependencies', () => {
    expect(workTemplateDraftSchema.safeParse(draft()).success).toBe(true)
  })

  test('normalizes blank optional text to null', () => {
    const result = workTemplateDraftSchema.parse({ ...draft(), description: '   ' })
    expect(result.description).toBeNull()
  })

  test('rejects evidence for an item outside the draft', () => {
    const value = draft()
    const result = workTemplateDraftSchema.safeParse({ ...value, evidence: [{ ...value.evidence[0], templateItemId: thirdId }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === 'evidence_item_missing')).toBe(true)
  })

  test('rejects self dependencies', () => {
    const value = draft()
    const result = workTemplateDraftSchema.safeParse({ ...value, dependencies: [{ ...value.dependencies[0], predecessorItemId: secondId }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === 'dependency_self')).toBe(true)
  })

  test('rejects dependency cycles', () => {
    const value = draft()
    const result = workTemplateDraftSchema.safeParse({ ...value, dependencies: [
      value.dependencies[0],
      { id: '00000000-0000-4000-8000-000000000004', predecessorItemId: secondId, dependentItemId: firstId },
    ] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === 'dependency_cycle')).toBe(true)
  })

  test('rejects duplicate item identities', () => {
    const value = draft()
    const result = workTemplateDraftSchema.safeParse({
      ...value,
      items: [value.items[0], { ...value.items[1], id: firstId }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === 'duplicate_item')).toBe(true)
  })

  test('rejects non-positive planned material quantities', () => {
    const value = draft()
    const result = workTemplateDraftSchema.safeParse({
      ...value,
      materials: [{ id: thirdId, itemId: firstId, preferredLocationId: null, plannedQuantity: 0, isBillable: true, notes: null, sortOrder: 0 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === 'materials.0.plannedQuantity')).toBe(true)
  })
})
