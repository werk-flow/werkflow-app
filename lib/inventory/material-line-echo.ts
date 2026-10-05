import type { InventoryPickerOption, JobMaterialLine } from './types';

/** What the planning dialog knows about one row before the server answers. */
export type MaterialLinePlan = {
  item: InventoryPickerOption;
  preferredLocationId: string | null;
  preferredLocationName: string | null;
  plannedQuantity: number;
  notes: string;
};

function planFields(
  plan: MaterialLinePlan,
): Pick<
  JobMaterialLine,
  | 'itemId'
  | 'itemName'
  | 'itemType'
  | 'unit'
  | 'categoryName'
  | 'isBillable'
  | 'availableQuantity'
  | 'preferredLocationId'
  | 'preferredLocationName'
  | 'plannedQuantity'
  | 'notes'
> {
  return {
    itemId: plan.item.id,
    itemName: plan.item.name,
    itemType: plan.item.itemType,
    unit: plan.item.unit,
    categoryName: plan.item.categoryName,
    isBillable: plan.item.isBillable,
    availableQuantity: plan.item.availableQuantity,
    preferredLocationId: plan.preferredLocationId,
    preferredLocationName: plan.preferredLocationName,
    plannedQuantity: plan.plannedQuantity,
    notes: plan.notes.trim() || null,
  };
}

/** The line a planned row shows until the server confirms it. Planning books nothing. */
export function buildPlannedMaterialLineDraft(
  target: { id: string; jobId: string | null; projectId: string | null },
  plan: MaterialLinePlan,
): JobMaterialLine {
  return {
    ...target,
    ...planFields(plan),
    takenQuantity: 0,
    returnedQuantity: 0,
    billableQuantity: 0,
    isUnplanned: false,
    status: 'planned',
  };
}

/** An edited plan keeps its booked quantities and status; only the plan fields change. */
export function applyMaterialLinePlan(line: JobMaterialLine, plan: MaterialLinePlan): JobMaterialLine {
  return { ...line, ...planFields(plan) };
}
