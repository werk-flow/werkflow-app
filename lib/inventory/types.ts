export type InventoryItemType = 'material' | 'consumable' | 'tool' | 'asset';
export type InventoryLocationType = 'storage' | 'room' | 'shelf' | 'vehicle' | 'other';
export type InventoryMovementType =
  | 'initial_count'
  | 'stock_in'
  | 'stock_out'
  | 'job_take'
  | 'job_return'
  | 'correction'
  | 'transfer_in'
  | 'transfer_out';
export type JobMaterialStatus =
  | 'planned'
  | 'partially_taken'
  | 'taken'
  | 'returned'
  | 'cancelled';
export type InventoryStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export type InventoryCategoryRow = {
  id: string;
  organization_id: string;
  parent_category_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type InventoryLocationRow = {
  id: string;
  organization_id: string;
  parent_location_id: string | null;
  name: string;
  description: string | null;
  location_type: InventoryLocationType;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InventorySupplierRow = {
  id: string;
  organization_id: string;
  name: string;
  customer_number: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryItemRow = {
  id: string;
  organization_id: string;
  item_type: InventoryItemType;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  internal_sku: string | null;
  manufacturer: string | null;
  supplier_id: string | null;
  supplier_article_number: string | null;
  purchase_price_cents: number | null;
  sale_price_cents: number | null;
  currency_code: string;
  tax_rate_basis_points: number;
  is_billable: boolean;
  global_minimum_stock: number | string;
  global_target_stock: number | string | null;
  track_quantity: boolean;
  track_individual_assets: boolean;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryBarcodeRow = {
  id: string;
  organization_id: string;
  item_id: string;
  barcode_value: string;
  barcode_type: string;
  is_primary: boolean;
  created_at: string;
};

export type InventoryStockLevelRow = {
  id: string;
  organization_id: string;
  item_id: string;
  location_id: string;
  quantity_on_hand: number | string;
  updated_at: string;
};

export type JobMaterialLineRow = {
  id: string;
  organization_id: string;
  job_id: string | null;
  project_id: string | null;
  item_id: string;
  preferred_location_id: string | null;
  planned_quantity: number | string;
  taken_quantity: number | string;
  returned_quantity: number | string;
  billable_quantity: number | string;
  is_billable: boolean;
  is_unplanned: boolean;
  status: JobMaterialStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryMovementRow = {
  id: string;
  organization_id: string;
  item_id: string;
  location_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number | string;
  quantity_before: number | string;
  quantity_after: number | string;
  job_id: string | null;
  project_id: string | null;
  job_material_line_id: string | null;
  import_batch_id: string | null;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
};

export type InventoryAssetInstanceRow = {
  id: string;
  organization_id: string;
  item_id: string;
  asset_tag: string | null;
  serial_number: string | null;
  status: string;
  current_location_id: string | null;
  assigned_to_user_id: string | null;
  current_job_id: string | null;
  purchased_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryCategory = {
  id: string;
  parentCategoryId: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type InventoryLocation = {
  id: string;
  parentLocationId: string | null;
  name: string;
  description: string | null;
  locationType: InventoryLocationType;
  sortOrder: number;
  isActive: boolean;
};

export type InventorySupplier = {
  id: string;
  name: string;
  customerNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
};

export type InventoryItem = {
  id: string;
  itemType: InventoryItemType;
  name: string;
  description: string | null;
  categoryId: string | null;
  unit: string;
  internalSku: string | null;
  manufacturer: string | null;
  supplierId: string | null;
  supplierArticleNumber: string | null;
  purchasePriceCents: number | null;
  salePriceCents: number | null;
  currencyCode: string;
  taxRateBasisPoints: number;
  isBillable: boolean;
  globalMinimumStock: number;
  globalTargetStock: number | null;
  trackQuantity: boolean;
  trackIndividualAssets: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryStockSlice = {
  locationId: string;
  locationName: string;
  quantityOnHand: number;
};

export type InventoryOverviewItem = InventoryItem & {
  categoryName: string | null;
  supplierName: string | null;
  primaryBarcode: string | null;
  barcodes: string[];
  totalOnHand: number;
  plannedQuantity: number;
  availableQuantity: number;
  stockStatus: InventoryStockStatus;
  stockByLocation: InventoryStockSlice[];
  assetInstanceCount: number;
};

export type InventoryMovementListItem = {
  id: string;
  itemId: string;
  itemName: string;
  locationId: string;
  locationName: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  jobId: string | null;
  jobTitle: string | null;
  jobNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  reason: string | null;
  createdAt: string;
};

export type InventoryOverview = {
  categories: InventoryCategory[];
  locations: InventoryLocation[];
  suppliers: InventorySupplier[];
  items: InventoryOverviewItem[];
  movements: InventoryMovementListItem[];
  summary: {
    totalItems: number;
    lowStockItems: number;
    outOfStockItems: number;
    plannedQuantity: number;
    totalOnHand: number;
  };
};

export type InventoryPickerOption = {
  id: string;
  itemType: InventoryItemType;
  name: string;
  unit: string;
  internalSku: string | null;
  manufacturer: string | null;
  supplierName: string | null;
  supplierArticleNumber: string | null;
  primaryBarcode: string | null;
  categoryName: string | null;
  isBillable: boolean;
  availableQuantity: number;
  stockByLocation: InventoryStockSlice[];
};

export type JobMaterialLine = {
  id: string;
  jobId: string | null;
  projectId: string | null;
  itemId: string;
  itemName: string;
  itemType: InventoryItemType;
  unit: string;
  categoryName: string | null;
  preferredLocationId: string | null;
  preferredLocationName: string | null;
  plannedQuantity: number;
  takenQuantity: number;
  returnedQuantity: number;
  billableQuantity: number;
  isBillable: boolean;
  isUnplanned: boolean;
  status: JobMaterialStatus;
  notes: string | null;
  availableQuantity: number;
};

export type ProjectMaterialSummary = {
  directLines: JobMaterialLine[];
  jobGroups: Array<{
    jobId: string;
    jobNumber: string | null;
    jobTitle: string;
    lines: JobMaterialLine[];
  }>;
  totals: Array<{
    itemId: string;
    itemName: string;
    unit: string;
    plannedQuantity: number;
    takenQuantity: number;
    returnedQuantity: number;
  }>;
};

export type InventoryUnitOption = {
  value: string;
  label: string;
};

export const INVENTORY_ITEM_TYPE_LABELS: Record<InventoryItemType, string> = {
  material: 'Material',
  consumable: 'Verbrauchsmaterial',
  tool: 'Werkzeug',
  asset: 'Gerät / Anlage',
};

export const INVENTORY_LOCATION_TYPE_LABELS: Record<InventoryLocationType, string> = {
  storage: 'Lager',
  room: 'Lagerraum',
  shelf: 'Regal',
  vehicle: 'Fahrzeug',
  other: 'Sonstiges',
};

export const INVENTORY_STOCK_STATUS_LABELS: Record<InventoryStockStatus, string> = {
  in_stock: 'Auf Lager',
  low_stock: 'Knapp',
  out_of_stock: 'Leer',
};

export const INVENTORY_MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  initial_count: 'Erstbestand',
  stock_in: 'Eingang',
  stock_out: 'Ausgang',
  job_take: 'Für Auftrag entnommen',
  job_return: 'Zurückgelegt',
  correction: 'Korrektur',
  transfer_in: 'Umlagerung Eingang',
  transfer_out: 'Umlagerung Ausgang',
};

export const JOB_MATERIAL_STATUS_LABELS: Record<JobMaterialStatus, string> = {
  planned: 'Geplant',
  partially_taken: 'Teilweise entnommen',
  taken: 'Entnommen',
  returned: 'Zurückgegeben',
  cancelled: 'Storniert',
};

export const INVENTORY_UNIT_OPTIONS: InventoryUnitOption[] = [
  { value: 'piece', label: 'Stück' },
  { value: 'meter', label: 'Meter' },
  { value: 'roll', label: 'Rolle' },
  { value: 'package', label: 'Packung' },
  { value: 'box', label: 'Karton' },
  { value: 'set', label: 'Set' },
  { value: 'pair', label: 'Paar' },
  { value: 'liter', label: 'Liter' },
  { value: 'kilogram', label: 'Kilogramm' },
  { value: 'sack', label: 'Sack' },
  { value: 'cartridge', label: 'Kartusche' },
  { value: 'bundle', label: 'Bund' },
  { value: 'pallet', label: 'Palette' },
];

export function formatInventoryQuantity(quantity: number, unit: string): string {
  const formatter = new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: 2,
  });
  return `${formatter.format(quantity)} ${getInventoryUnitLabel(unit)}`;
}

export function formatInventoryPrice(cents: number | null): string {
  if (cents === null) return '-';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

export function getInventoryUnitLabel(unit: string): string {
  return INVENTORY_UNIT_OPTIONS.find((option) => option.value === unit)?.label ?? unit;
}

export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toInventoryCategory(row: InventoryCategoryRow): InventoryCategory {
  return {
    id: row.id,
    parentCategoryId: row.parent_category_id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export function toInventoryLocation(row: InventoryLocationRow): InventoryLocation {
  return {
    id: row.id,
    parentLocationId: row.parent_location_id,
    name: row.name,
    description: row.description,
    locationType: row.location_type,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export function toInventorySupplier(row: InventorySupplierRow): InventorySupplier {
  return {
    id: row.id,
    name: row.name,
    customerNumber: row.customer_number,
    email: row.email,
    phone: row.phone,
    website: row.website,
    notes: row.notes,
  };
}

export function toInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    itemType: row.item_type,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    unit: row.unit,
    internalSku: row.internal_sku,
    manufacturer: row.manufacturer,
    supplierId: row.supplier_id,
    supplierArticleNumber: row.supplier_article_number,
    purchasePriceCents: row.purchase_price_cents,
    salePriceCents: row.sale_price_cents,
    currencyCode: row.currency_code,
    taxRateBasisPoints: row.tax_rate_basis_points,
    isBillable: row.is_billable,
    globalMinimumStock: toNumber(row.global_minimum_stock),
    globalTargetStock:
      row.global_target_stock === null ? null : toNumber(row.global_target_stock),
    trackQuantity: row.track_quantity,
    trackIndividualAssets: row.track_individual_assets,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
