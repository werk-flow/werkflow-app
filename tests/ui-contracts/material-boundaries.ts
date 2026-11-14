// Isolated server state of the job material section: one catalog item, one
// storage location and the job's material lines. A planned line waits in the
// write gate; an accepted plan becomes a line of the next route read.
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

export const materialContractItem: InventoryPickerOption = {
  id: 'contract-item',
  itemType: 'material',
  name: 'Kupferrohr 15 mm',
  unit: 'piece',
  internalSku: null,
  manufacturer: null,
  supplierName: null,
  supplierArticleNumber: null,
  primaryBarcode: null,
  categoryName: null,
  isBillable: true,
  availableQuantity: 20,
  stockByLocation: [{ locationId: 'contract-location', locationName: 'Hauptlager', quantityOnHand: 20 }],
};

export const materialContractLocation: InventoryLocation = {
  id: 'contract-location',
  parentLocationId: null,
  name: 'Hauptlager',
  description: null,
  locationType: 'storage',
  sortOrder: 0,
  isActive: true,
};

declare global {
  interface Window {
    uiContractMaterial: { lines: JobMaterialLine[] };
  }
}

/** A line whose two pieces a worker took for the job; the use contract starts from it. */
const takenContractLine: JobMaterialLine = {
  id: 'contract-taken-line',
  jobId: 'contract-job',
  projectId: null,
  itemId: materialContractItem.id,
  itemName: materialContractItem.name,
  itemType: materialContractItem.itemType,
  unit: materialContractItem.unit,
  categoryName: null,
  preferredLocationId: materialContractLocation.id,
  preferredLocationName: materialContractLocation.name,
  plannedQuantity: 2,
  takenQuantity: 2,
  usedQuantity: 0,
  returnedQuantity: 0,
  billableQuantity: 2,
  isBillable: true,
  isUnplanned: false,
  status: 'taken',
  notes: null,
  availableQuantity: materialContractItem.availableQuantity,
};

window.uiContractMaterial = {
  lines:
    window.uiContractFixture === 'material-use' || window.uiContractFixture === 'material-use-off-page'
      ? [takenContractLine]
      : [],
};

export function readMaterialLinesContract(): { success: true; lines: JobMaterialLine[] } {
  return { success: true, lines: structuredClone(window.uiContractMaterial.lines) };
}

export async function createJobMaterialLineContract(input: {
  jobId: string;
  itemId: string;
  preferredLocationId: string | null;
  plannedQuantity: number;
  notes: string;
}): Promise<{ success: true; lineId: string } | { success: false; error: string }> {
  const refusal = await holdWrite('create-job-material-line', input);
  if (refusal) return { success: false, error: refusal };
  const lineId = `contract-line-${window.uiContractMaterial.lines.length + 1}`;
  window.uiContractMaterial.lines = [
    ...window.uiContractMaterial.lines,
    {
      id: lineId,
      jobId: input.jobId,
      projectId: null,
      itemId: input.itemId,
      itemName: materialContractItem.name,
      itemType: materialContractItem.itemType,
      unit: materialContractItem.unit,
      categoryName: null,
      preferredLocationId: input.preferredLocationId,
      preferredLocationName: input.preferredLocationId ? materialContractLocation.name : null,
      plannedQuantity: input.plannedQuantity,
      takenQuantity: 0,
      usedQuantity: 0,
      returnedQuantity: 0,
      billableQuantity: 0,
      isBillable: true,
      isUnplanned: false,
      status: 'planned',
      notes: input.notes || null,
      availableQuantity: materialContractItem.availableQuantity,
    },
  ];
  return { success: true, lineId };
}

export async function recordJobMaterialUseContract(input: {
  operationId: string;
  lineId: string;
  quantity: number;
  note?: string | null;
}): Promise<{ success: true; usedQuantity: number } | { success: false; error: string }> {
  const refusal = await holdWrite('record-job-material-use', input);
  if (refusal) return { success: false, error: refusal };
  let usedQuantity = 0;
  window.uiContractMaterial.lines = window.uiContractMaterial.lines.map((line) => {
    if (line.id !== input.lineId) return line;
    usedQuantity = line.usedQuantity + input.quantity;
    return { ...line, usedQuantity };
  });
  // The real action revalidates the Auftrag pages, so its response renders the route.
  window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT));
  return { success: true, usedQuantity };
}

export async function readMaterialPickerContract(): Promise<{
  success: true;
  items: InventoryPickerOption[];
  locations: InventoryLocation[];
}> {
  return { success: true, items: [materialContractItem], locations: [materialContractLocation] };
}
