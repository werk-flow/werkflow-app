import type { CapabilityKind } from '@/lib/qualifications/types';
import type { WorkTemplateDraft, WorkTemplateTargetType } from '@/lib/work-templates/types';

export const ERROR_MESSAGES = {
  validation_failed: 'Bitte prüfe die markierten Angaben.',
  work_template_item_required: 'Füge mindestens eine Aufgabe oder einen Checklistenpunkt hinzu.',
  work_template_dependency_cycle: 'Abhängigkeiten dürfen keinen Kreis bilden.',
  work_template_reference_unavailable:
    'Mindestens ein Material, Lager oder eine Qualifikation ist nicht mehr aktiv.',
  not_authorized: 'Du darfst Arbeitsvorlagen nicht verwalten.',
  operation_failed: 'Die Änderung konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

export type CreateTemplateInput = { name: string; description: string; targetType: WorkTemplateTargetType };
export type CreateInventoryItemInput = { name: string; unit: string };
/** An article created from the editor, held optimistically until the server confirms it. */
export type CreatedInventoryItem = {
  id: string;
  name: string;
  unit: string;
  internalSku: string | null;
  isBillable: boolean;
};
export type CreateCapabilityInput = { name: string; kind: CapabilityKind };

export function newId(): string {
  return crypto.randomUUID();
}

export function getId(entity: { id: string }): string {
  return entity.id;
}

export function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const current = items[index];
  const swapped = items[target];
  if (current === undefined || swapped === undefined) return items;
  const next = [...items];
  next[index] = swapped;
  next[target] = current;
  return next;
}

/**
 * The draft as saved: every list carries its on-screen position as `sortOrder`.
 * Evidence is ordered per task, so removing one entry leaves no gap that a
 * later entry could collide with.
 */
export function withWorkTemplateSortOrders(draft: WorkTemplateDraft): WorkTemplateDraft {
  const evidenceCountByItem = new Map<string, number>();
  return {
    ...draft,
    items: draft.items.map((item, index) => ({ ...item, sortOrder: index })),
    evidence: draft.evidence.map((entry) => {
      const sortOrder = evidenceCountByItem.get(entry.templateItemId) ?? 0;
      evidenceCountByItem.set(entry.templateItemId, sortOrder + 1);
      return { ...entry, sortOrder };
    }),
    materials: draft.materials.map((item, index) => ({ ...item, sortOrder: index })),
    capabilities: draft.capabilities.map((item, index) => ({ ...item, sortOrder: index })),
  };
}
