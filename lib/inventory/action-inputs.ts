import type { InventoryItemType, InventoryLocationType } from './types';

// The parameter shapes of the inventory Server Actions in `./actions` and
// `./catalog-actions`. Each action parses its input with its schema in
// `./action-schemas` before the first use.

export type CreateInventoryLocationInput = {
  name: string;
  description?: string | null;
  locationType?: InventoryLocationType;
  parentLocationId?: string | null;
};

export type UpsertInventoryItemInput = {
  id?: string;
  name: string;
  itemType: InventoryItemType;
  description?: string | null;
  categoryId?: string | null;
  unit: string;
  internalSku?: string | null;
  manufacturer?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierArticleNumber?: string | null;
  purchasePriceCents?: number | null;
  salePriceCents?: number | null;
  isBillable: boolean;
  globalMinimumStock?: number;
  globalTargetStock?: number | null;
  trackQuantity?: boolean;
  trackIndividualAssets?: boolean;
  barcode?: string | null;
  notes?: string | null;
  initialLocationId?: string | null;
  initialQuantity?: number | null;
};

export type AdjustInventoryStockInput = {
  itemId: string;
  locationId: string;
  direction?: 'add' | 'remove';
  quantityDelta?: number;
  quantity?: number;
  reason?: string | null;
};

export type CreateJobMaterialLineInput = {
  jobId: string;
  itemId: string;
  preferredLocationId?: string | null;
  plannedQuantity: number;
  notes?: string | null;
};

export type CreateProjectMaterialLineInput = {
  projectId: string;
  itemId: string;
  preferredLocationId?: string | null;
  plannedQuantity: number;
  notes?: string | null;
};

export type UpdateJobMaterialLineInput = {
  lineId: string;
  itemId?: string;
  preferredLocationId?: string | null;
  plannedQuantity?: number;
  isBillable?: boolean;
  notes?: string | null;
};

export type TakeJobMaterialInput = {
  jobId: string;
  lineId?: string | null;
  itemId?: string | null;
  locationId: string;
  quantity: number;
  reason?: string | null;
};

export type ReturnJobMaterialInput = {
  lineId: string;
  locationId: string;
  quantity: number;
  reason?: string | null;
};

export type InventoryImportRow = {
  name: string;
  itemType?: InventoryItemType;
  categoryName?: string | null;
  locationName?: string | null;
  unit?: string | null;
  quantity?: number | null;
  minimumStock?: number | null;
  targetStock?: number | null;
  internalSku?: string | null;
  barcode?: string | null;
  manufacturer?: string | null;
  supplierName?: string | null;
  supplierArticleNumber?: string | null;
  purchasePriceCents?: number | null;
  salePriceCents?: number | null;
  isBillable?: boolean | null;
  notes?: string | null;
};

export type ImportInventoryRowsInput = {
  fileName: string;
  columnMapping: Record<string, string>;
  rows: InventoryImportRow[];
};
