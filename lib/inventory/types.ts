import type { Database } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import type { InventoryPageQuery } from './list-page';

// The values the database check constraints allow for each text column.
export const INVENTORY_ITEM_TYPES = ['material', 'consumable', 'tool', 'asset'] as const;
export const INVENTORY_LOCATION_TYPES = ['storage', 'room', 'shelf', 'vehicle', 'other'] as const;
const INVENTORY_MOVEMENT_TYPES = [
  'initial_count',
  'stock_in',
  'stock_out',
  'job_take',
  'job_return',
  'correction',
  'transfer_in',
  'transfer_out',
] as const;
const JOB_MATERIAL_STATUSES = ['planned', 'partially_taken', 'taken', 'returned', 'cancelled'] as const;

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number];
export type InventoryLocationType = (typeof INVENTORY_LOCATION_TYPES)[number];
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
export type JobMaterialStatus = (typeof JOB_MATERIAL_STATUSES)[number];
export type InventoryStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export function toJobMaterialStatus(value: string): JobMaterialStatus {
  return constrainedValue(JOB_MATERIAL_STATUSES, value, 'job material status');
}

export function toInventoryMovementType(value: string): InventoryMovementType {
  return constrainedValue(INVENTORY_MOVEMENT_TYPES, value, 'movement type');
}

type Tables = Database['public']['Tables'];
export type InventoryCategoryRow = Tables['inventory_categories']['Row'];
export type InventoryLocationRow = Tables['inventory_locations']['Row'];
export type InventorySupplierRow = Tables['inventory_suppliers']['Row'];
export type InventoryItemRow = Tables['inventory_items']['Row'];
export type InventoryBarcodeRow = Tables['inventory_item_barcodes']['Row'];
export type InventoryStockLevelRow = Tables['inventory_stock_levels']['Row'];
export type JobMaterialLineRow = Tables['job_material_lines']['Row'];
export type InventoryMovementRow = Tables['inventory_movements']['Row'];
export type InventoryAssetInstanceRow = Tables['inventory_asset_instances']['Row'];

export type InventoryCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
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

type InventoryStockSlice = {
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
  page: {
    query: InventoryPageQuery;
    ids: string[];
    total: number;
    locationIds: string[];
    locationCounts: Record<string, number>;
  };
  categories: InventoryCategory[];
  locations: InventoryLocation[];
  suppliers: InventorySupplier[];
  items: InventoryOverviewItem[];
  movements: InventoryMovementListItem[];
  summary: {
    totalItems: number;
    stockedItems: number;
    plannedItems: number;
    lowStockItems: number;
    outOfStockItems: number;
    plannedQuantity: number;
    totalOnHand: number;
  };
};

/** One page of picker choices; a search reaches the rest of the catalog. */
export const INVENTORY_PICKER_PAGE_SIZE = 50;

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
    billableQuantity: number;
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
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

export function toInventoryLocation(row: InventoryLocationRow): InventoryLocation {
  return {
    id: row.id,
    parentLocationId: row.parent_location_id,
    name: row.name,
    description: row.description,
    locationType: constrainedValue(INVENTORY_LOCATION_TYPES, row.location_type, 'location type'),
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
    itemType: constrainedValue(INVENTORY_ITEM_TYPES, row.item_type, 'item type'),
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
    globalTargetStock: row.global_target_stock === null ? null : toNumber(row.global_target_stock),
    trackQuantity: row.track_quantity,
    trackIndividualAssets: row.track_individual_assets,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
