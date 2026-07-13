'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { AuthContext } from '@/lib/jobs/auth';
import type {
  InventoryBarcodeRow,
  InventoryCategoryRow,
  InventoryItem,
  InventoryItemRow,
  InventoryItemType,
  InventoryLocation,
  InventoryLocationRow,
  InventoryLocationType,
  InventoryMovementListItem,
  InventoryMovementRow,
  InventoryOverview,
  InventoryOverviewItem,
  InventoryPickerOption,
  ProjectMaterialSummary,
  InventoryStockLevelRow,
  InventoryStockStatus,
  InventorySupplierRow,
  JobMaterialLine,
  JobMaterialLineRow,
  InventoryAssetInstanceRow,
} from './types';
import {
  toInventoryCategory,
  toInventoryItem,
  toInventoryLocation,
  toInventorySupplier,
  toNumber,
} from './types';

type ActionResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

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

async function getAuthContext(): Promise<ActionResult<{ context: AuthContext }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };

  return { success: true, context: auth.context };
}

async function requireInventoryManager(): Promise<ActionResult<{ context: AuthContext }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return auth;
}

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function asRow<T>(data: unknown): T | null {
  return data ? (data as T) : null;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

function normalizePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeInventoryUnitInput(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ü/g, 'ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe');

  if (!normalized) return 'piece';

  const aliases: Record<string, string> = {
    stueck: 'piece',
    stuck: 'piece',
    stk: 'piece',
    st: 'piece',
    piece: 'piece',
    pieces: 'piece',
    meter: 'meter',
    m: 'meter',
    rolle: 'roll',
    roll: 'roll',
    packung: 'package',
    paket: 'package',
    package: 'package',
    karton: 'box',
    box: 'box',
    set: 'set',
    paar: 'pair',
    pair: 'pair',
    liter: 'liter',
    l: 'liter',
    kilogramm: 'kilogram',
    kilogram: 'kilogram',
    kg: 'kilogram',
    sack: 'sack',
    kartusche: 'cartridge',
    cartridge: 'cartridge',
    bund: 'bundle',
    bundle: 'bundle',
    palette: 'pallet',
    pallet: 'pallet',
  };

  return aliases[normalized] ?? value?.trim() ?? 'piece';
}

function getStockStatus(item: InventoryItem, totalOnHand: number): InventoryStockStatus {
  if (!item.trackQuantity) return 'in_stock';
  if (totalOnHand <= 0) return 'out_of_stock';
  if (item.globalMinimumStock > 0 && totalOnHand <= item.globalMinimumStock) {
    return 'low_stock';
  }
  return 'in_stock';
}

function invalidateInventory(orgId: string) {
  updateTag(CACHE_TAGS.inventory(orgId));
  revalidatePath('/inventar');
}

async function ensureInventoryDefaults(
  admin: SupabaseAdminClient,
  context: AuthContext
): Promise<void> {
  const { error } = await admin.rpc('ensure_inventory_defaults', {
    p_org_id: context.orgId,
    p_actor_id: context.userId,
  });

  if (error) {
    console.error('Error ensuring inventory defaults:', error);
  }
}

async function getJobContext(
  admin: SupabaseAdminClient,
  context: AuthContext,
  jobId: string
): Promise<ActionResult<{ job: { id: string; project_id: string | null } }>> {
  const { data, error } = await admin
    .from('jobs')
    .select('id, project_id')
    .eq('id', jobId)
    .eq('organization_id', context.orgId)
    .maybeSingle();

  const job = asRow<{ id: string; project_id: string | null }>(data);
  if (error || !job) {
    return { success: false, error: 'job_not_found' };
  }

  if (!context.isManagerOrAbove) {
    const { data: assignment } = await admin
      .from('job_assignments')
      .select('id')
      .eq('job_id', jobId)
      .eq('user_id', context.userId)
      .maybeSingle();

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
  }

  return { success: true, job };
}

async function getProjectContext(
  admin: SupabaseAdminClient,
  context: AuthContext,
  projectId: string
): Promise<ActionResult<{ project: { id: string } }>> {
  const { data, error } = await admin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', context.orgId)
    .maybeSingle();

  const project = asRow<{ id: string }>(data);
  if (error || !project) {
    return { success: false, error: 'project_not_found' };
  }

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, project };
}

async function ensureSupplier(
  admin: SupabaseAdminClient,
  orgId: string,
  supplierId: string | null | undefined,
  supplierName: string | null | undefined
): Promise<string | null> {
  if (supplierId) return supplierId;

  const name = cleanText(supplierName);
  if (!name) return null;

  const { data: existing } = await admin
    .from('inventory_suppliers')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', name)
    .maybeSingle();

  const existingSupplier = asRow<{ id: string }>(existing);
  if (existingSupplier) return existingSupplier.id;

  const { data, error } = await admin
    .from('inventory_suppliers')
    .insert({
      organization_id: orgId,
      name,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating inventory supplier:', error);
    return null;
  }

  return asRow<{ id: string }>(data)?.id ?? null;
}

async function ensureCategory(
  admin: SupabaseAdminClient,
  orgId: string,
  categoryName: string | null | undefined
): Promise<string | null> {
  const name = cleanText(categoryName);
  if (!name) return null;

  const { data: existing } = await admin
    .from('inventory_categories')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', name)
    .maybeSingle();

  const existingCategory = asRow<{ id: string }>(existing);
  if (existingCategory) return existingCategory.id;

  const { data, error } = await admin
    .from('inventory_categories')
    .insert({
      organization_id: orgId,
      name,
      sort_order: 100,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating inventory category:', error);
    return null;
  }

  return asRow<{ id: string }>(data)?.id ?? null;
}

async function ensureLocation(
  admin: SupabaseAdminClient,
  context: AuthContext,
  locationName: string | null | undefined
): Promise<string | null> {
  const name = cleanText(locationName);
  if (!name) return null;

  const { data: existing } = await admin
    .from('inventory_locations')
    .select('id')
    .eq('organization_id', context.orgId)
    .ilike('name', name)
    .maybeSingle();

  const existingLocation = asRow<{ id: string }>(existing);
  if (existingLocation) return existingLocation.id;

  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      organization_id: context.orgId,
      name,
      location_type: 'room',
      created_by: context.userId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating inventory location:', error);
    return null;
  }

  return asRow<{ id: string }>(data)?.id ?? null;
}

async function recordMovement(
  admin: SupabaseAdminClient,
  context: AuthContext,
  input: {
    itemId: string;
    locationId: string;
    movementType: string;
    quantityDelta: number;
    jobId?: string | null;
    projectId?: string | null;
    jobMaterialLineId?: string | null;
    importBatchId?: string | null;
    reason?: string | null;
  }
): Promise<ActionResult<{ quantityAfter: number }>> {
  const { data, error } = await admin.rpc('record_inventory_movement', {
    p_organization_id: context.orgId,
    p_actor_id: context.userId,
    p_item_id: input.itemId,
    p_location_id: input.locationId,
    p_movement_type: input.movementType,
    p_quantity_delta: input.quantityDelta,
    p_job_id: input.jobId ?? null,
    p_project_id: input.projectId ?? null,
    p_job_material_line_id: input.jobMaterialLineId ?? null,
    p_import_batch_id: input.importBatchId ?? null,
    p_reason: cleanText(input.reason),
  });

  if (error) {
    console.error('Error recording inventory movement.', {
      code: error.code ?? 'unknown',
    });
    if (error.message?.includes('inventory stock cannot go below zero')) {
      return { success: false, error: 'stock_would_go_negative' };
    }
    if (error.message?.includes('not a member')) {
      return { success: false, error: 'not_authorized' };
    }
    return { success: false, error: 'movement_failed' };
  }

  return { success: true, quantityAfter: toNumber(data as number | string | null) };
}

async function deleteFailedUnplannedMaterialLine(
  admin: SupabaseAdminClient,
  organizationId: string,
  lineId: string
): Promise<void> {
  const { error } = await admin
    .from('job_material_lines')
    .delete()
    .eq('id', lineId)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('Error cleaning up failed unplanned material line.', {
      code: error.code ?? 'unknown',
    });
  }
}

type InventoryOrganizationReferenceTable =
  | 'inventory_categories'
  | 'inventory_locations';

async function resolveInventoryOrganizationReference(
  admin: SupabaseAdminClient,
  table: InventoryOrganizationReferenceTable,
  organizationId: string,
  inputId: string | null | undefined,
  missingError: 'category_not_found' | 'location_not_found'
): Promise<ActionResult<{ referenceId: string | null }>> {
  const referenceId = cleanText(inputId);
  if (!referenceId) return { success: true, referenceId: null };

  const { data, error } = await admin
    .from(table)
    .select('id')
    .eq('id', referenceId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    console.error('Error resolving inventory organization reference.', {
      code: error.code ?? 'unknown',
      table,
    });
    return { success: false, error: 'reference_lookup_failed' };
  }

  const resolvedReference = asRow<{ id: string }>(data);
  if (!resolvedReference) return { success: false, error: missingError };

  return { success: true, referenceId: resolvedReference.id };
}

export async function getInventoryOverview(): Promise<ActionResult<{ overview: InventoryOverview }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { orgId } = auth.context;
  await ensureInventoryDefaults(admin, auth.context);

  const [
    categoriesResult,
    locationsResult,
    suppliersResult,
    itemsResult,
    barcodesResult,
    stockLevelsResult,
    materialLinesResult,
    movementsResult,
    assetInstancesResult,
    jobsResult,
    projectsResult,
  ] = await Promise.all([
    admin
      .from('inventory_categories')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('inventory_locations')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('inventory_suppliers')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    admin
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    admin
      .from('inventory_item_barcodes')
      .select('*')
      .eq('organization_id', orgId)
      .order('is_primary', { ascending: false }),
    admin
      .from('inventory_stock_levels')
      .select('*')
      .eq('organization_id', orgId),
    admin
      .from('job_material_lines')
      .select('*')
      .eq('organization_id', orgId)
      .neq('status', 'cancelled'),
    admin
      .from('inventory_movements')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(40),
    admin
      .from('inventory_asset_instances')
      .select('*')
      .eq('organization_id', orgId),
    admin
      .from('jobs')
      .select('id, job_number, title')
      .eq('organization_id', orgId),
    admin
      .from('projects')
      .select('id, project_number, name')
      .eq('organization_id', orgId),
  ]);

  if (categoriesResult.error) return { success: false, error: 'categories_failed' };
  if (locationsResult.error) return { success: false, error: 'locations_failed' };
  if (suppliersResult.error) return { success: false, error: 'suppliers_failed' };
  if (itemsResult.error) return { success: false, error: 'items_failed' };
  if (barcodesResult.error) return { success: false, error: 'barcodes_failed' };
  if (stockLevelsResult.error) return { success: false, error: 'stock_failed' };
  if (materialLinesResult.error) return { success: false, error: 'materials_failed' };
  if (movementsResult.error) return { success: false, error: 'movements_failed' };
  if (assetInstancesResult.error) return { success: false, error: 'assets_failed' };
  if (jobsResult.error) return { success: false, error: 'jobs_failed' };
  if (projectsResult.error) return { success: false, error: 'projects_failed' };

  const categories = asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory);
  const locations = asRows<InventoryLocationRow>(locationsResult.data).map(toInventoryLocation);
  const suppliers = asRows<InventorySupplierRow>(suppliersResult.data).map(toInventorySupplier);
  const items = asRows<InventoryItemRow>(itemsResult.data).map(toInventoryItem);
  const barcodes = asRows<InventoryBarcodeRow>(barcodesResult.data);
  const stockLevels = asRows<InventoryStockLevelRow>(stockLevelsResult.data);
  const materialLines = asRows<JobMaterialLineRow>(materialLinesResult.data);
  const movements = asRows<InventoryMovementRow>(movementsResult.data);
  const assetInstances = asRows<InventoryAssetInstanceRow>(assetInstancesResult.data);
  const jobs = asRows<{ id: string; job_number: string | null; title: string }>(
    jobsResult.data
  );
  const projects = asRows<{ id: string; project_number: string | null; name: string }>(
    projectsResult.data
  );

  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const barcodesByItem = new Map<string, InventoryBarcodeRow[]>();
  for (const barcode of barcodes) {
    const list = barcodesByItem.get(barcode.item_id) ?? [];
    list.push(barcode);
    barcodesByItem.set(barcode.item_id, list);
  }

  const stockByItem = new Map<string, InventoryStockLevelRow[]>();
  for (const stock of stockLevels) {
    const list = stockByItem.get(stock.item_id) ?? [];
    list.push(stock);
    stockByItem.set(stock.item_id, list);
  }

  const plannedByItem = new Map<string, number>();
  for (const line of materialLines) {
    const plannedOpen = Math.max(
      0,
      toNumber(line.planned_quantity) - toNumber(line.taken_quantity)
    );
    plannedByItem.set(
      line.item_id,
      (plannedByItem.get(line.item_id) ?? 0) + plannedOpen
    );
  }

  const assetCountByItem = new Map<string, number>();
  for (const asset of assetInstances) {
    assetCountByItem.set(asset.item_id, (assetCountByItem.get(asset.item_id) ?? 0) + 1);
  }

  const overviewItems: InventoryOverviewItem[] = items.map((item) => {
    const itemStock = stockByItem.get(item.id) ?? [];
    const stockByLocation = itemStock.map((stock) => ({
      locationId: stock.location_id,
      locationName: locationMap.get(stock.location_id)?.name ?? 'Unbekanntes Lager',
      quantityOnHand: toNumber(stock.quantity_on_hand),
    }));
    const totalOnHand = stockByLocation.reduce(
      (sum, stock) => sum + stock.quantityOnHand,
      0
    );
    const plannedQuantity = plannedByItem.get(item.id) ?? 0;
    const itemBarcodes = barcodesByItem.get(item.id) ?? [];
    const primaryBarcode =
      itemBarcodes.find((barcode) => barcode.is_primary)?.barcode_value ??
      itemBarcodes[0]?.barcode_value ??
      null;

    return {
      ...item,
      categoryName: item.categoryId ? categoryMap.get(item.categoryId)?.name ?? null : null,
      supplierName: item.supplierId ? supplierMap.get(item.supplierId)?.name ?? null : null,
      primaryBarcode,
      barcodes: itemBarcodes.map((barcode) => barcode.barcode_value),
      totalOnHand,
      plannedQuantity,
      availableQuantity: Math.max(0, totalOnHand - plannedQuantity),
      stockStatus: getStockStatus(item, totalOnHand),
      stockByLocation,
      assetInstanceCount: assetCountByItem.get(item.id) ?? 0,
    };
  });

  const movementItems: InventoryMovementListItem[] = movements.map((movement) => ({
    id: movement.id,
    itemId: movement.item_id,
    itemName: itemMap.get(movement.item_id)?.name ?? 'Unbekannter Artikel',
    locationId: movement.location_id,
    locationName: locationMap.get(movement.location_id)?.name ?? 'Unbekanntes Lager',
    movementType: movement.movement_type,
    quantityDelta: toNumber(movement.quantity_delta),
    quantityBefore: toNumber(movement.quantity_before),
    quantityAfter: toNumber(movement.quantity_after),
    jobId: movement.job_id,
    jobTitle: movement.job_id ? jobMap.get(movement.job_id)?.title ?? null : null,
    jobNumber: movement.job_id ? jobMap.get(movement.job_id)?.job_number ?? null : null,
    projectId: movement.project_id,
    projectName: movement.project_id ? projectMap.get(movement.project_id)?.name ?? null : null,
    projectNumber: movement.project_id
      ? projectMap.get(movement.project_id)?.project_number ?? null
      : null,
    reason: movement.reason,
    createdAt: movement.created_at,
  }));

  const summary = {
    totalItems: overviewItems.length,
    lowStockItems: overviewItems.filter((item) => item.stockStatus === 'low_stock').length,
    outOfStockItems: overviewItems.filter((item) => item.stockStatus === 'out_of_stock').length,
    plannedQuantity: overviewItems.reduce((sum, item) => sum + item.plannedQuantity, 0),
    totalOnHand: overviewItems.reduce((sum, item) => sum + item.totalOnHand, 0),
  };

  return {
    success: true,
    overview: {
      categories,
      locations,
      suppliers,
      items: overviewItems,
      movements: movementItems,
      summary,
    },
  };
}

export async function getInventoryPickerOptions(): Promise<
  ActionResult<{ items: InventoryPickerOption[]; locations: InventoryLocation[] }>
> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { orgId } = auth.context;
  await ensureInventoryDefaults(admin, auth.context);

  const [
    itemsResult,
    categoriesResult,
    suppliersResult,
    stockResult,
    locationsResult,
    barcodesResult,
  ] = await Promise.all([
    admin
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    admin.from('inventory_categories').select('*').eq('organization_id', orgId),
    admin.from('inventory_suppliers').select('*').eq('organization_id', orgId),
    admin.from('inventory_stock_levels').select('*').eq('organization_id', orgId),
    admin
      .from('inventory_locations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('inventory_item_barcodes')
      .select('*')
      .eq('organization_id', orgId)
      .order('is_primary', { ascending: false }),
  ]);

  if (itemsResult.error) return { success: false, error: 'items_failed' };
  if (categoriesResult.error) return { success: false, error: 'categories_failed' };
  if (suppliersResult.error) return { success: false, error: 'suppliers_failed' };
  if (stockResult.error) return { success: false, error: 'stock_failed' };
  if (locationsResult.error) return { success: false, error: 'locations_failed' };
  if (barcodesResult.error) return { success: false, error: 'barcodes_failed' };

  const categories = asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory);
  const suppliers = asRows<InventorySupplierRow>(suppliersResult.data).map(toInventorySupplier);
  const locations = asRows<InventoryLocationRow>(locationsResult.data).map(toInventoryLocation);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const barcodesByItem = new Map<string, InventoryBarcodeRow[]>();

  for (const barcode of asRows<InventoryBarcodeRow>(barcodesResult.data)) {
    const list = barcodesByItem.get(barcode.item_id) ?? [];
    list.push(barcode);
    barcodesByItem.set(barcode.item_id, list);
  }

  const stockByItem = new Map<string, InventoryStockLevelRow[]>();
  for (const stock of asRows<InventoryStockLevelRow>(stockResult.data)) {
    const list = stockByItem.get(stock.item_id) ?? [];
    list.push(stock);
    stockByItem.set(stock.item_id, list);
  }

  const pickerItems = asRows<InventoryItemRow>(itemsResult.data).map((row) => {
    const item = toInventoryItem(row);
    const stockByLocation = (stockByItem.get(item.id) ?? []).map((stock) => ({
      locationId: stock.location_id,
      locationName: locationMap.get(stock.location_id)?.name ?? 'Unbekanntes Lager',
      quantityOnHand: toNumber(stock.quantity_on_hand),
    }));
    return {
      id: item.id,
      itemType: item.itemType,
      name: item.name,
      unit: item.unit,
      internalSku: item.internalSku,
      manufacturer: item.manufacturer,
      supplierName: item.supplierId
        ? supplierMap.get(item.supplierId)?.name ?? null
        : null,
      supplierArticleNumber: item.supplierArticleNumber,
      primaryBarcode:
        barcodesByItem.get(item.id)?.find((barcode) => barcode.is_primary)
          ?.barcode_value ??
        barcodesByItem.get(item.id)?.[0]?.barcode_value ??
        null,
      categoryName: item.categoryId ? categoryMap.get(item.categoryId)?.name ?? null : null,
      isBillable: item.isBillable,
      availableQuantity: stockByLocation.reduce(
        (sum, stock) => sum + stock.quantityOnHand,
        0
      ),
      stockByLocation,
    };
  });

  return { success: true, items: pickerItems, locations };
}

export async function createInventoryLocation(
  input: CreateInventoryLocationInput
): Promise<ActionResult<{ location: InventoryLocation }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const name = cleanText(input.name);
  if (!name) return { success: false, error: 'name_required' };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      organization_id: auth.context.orgId,
      parent_location_id: input.parentLocationId ?? null,
      name,
      description: cleanText(input.description),
      location_type: input.locationType ?? 'room',
      created_by: auth.context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error creating inventory location:', error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory(auth.context.orgId);
  return { success: true, location: toInventoryLocation(data as InventoryLocationRow) };
}

export async function upsertInventoryItem(
  input: UpsertInventoryItemInput
): Promise<ActionResult<{ item: InventoryItem }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const name = cleanText(input.name);
  if (!name) return { success: false, error: 'name_required' };
  if (!input.unit.trim()) return { success: false, error: 'unit_required' };

  const initialQuantity = normalizeQuantity(input.initialQuantity ?? 0);
  const requestedInitialLocationId = input.id ? null : input.initialLocationId ?? null;
  if (initialQuantity > 0 && !requestedInitialLocationId) {
    return { success: false, error: 'location_required_for_initial_stock' };
  }

  const admin = createSupabaseAdminClient();
  const [categoryReference, initialLocationReference] = await Promise.all([
    resolveInventoryOrganizationReference(
      admin,
      'inventory_categories',
      auth.context.orgId,
      input.categoryId,
      'category_not_found'
    ),
    resolveInventoryOrganizationReference(
      admin,
      'inventory_locations',
      auth.context.orgId,
      requestedInitialLocationId,
      'location_not_found'
    ),
  ]);
  if (!categoryReference.success) return categoryReference;
  if (!initialLocationReference.success) return initialLocationReference;

  const initialLocationId = initialLocationReference.referenceId;
  const supplierId = await ensureSupplier(
    admin,
    auth.context.orgId,
    input.supplierId,
    input.supplierName
  );

  const payload = {
    organization_id: auth.context.orgId,
    item_type: input.itemType,
    name,
    description: cleanText(input.description),
    category_id: categoryReference.referenceId,
    unit: normalizeInventoryUnitInput(input.unit),
    internal_sku: cleanText(input.internalSku),
    manufacturer: cleanText(input.manufacturer),
    supplier_id: supplierId,
    supplier_article_number: cleanText(input.supplierArticleNumber),
    purchase_price_cents: normalizePrice(input.purchasePriceCents),
    sale_price_cents: normalizePrice(input.salePriceCents),
    is_billable: input.isBillable,
    global_minimum_stock: normalizeQuantity(input.globalMinimumStock ?? 0),
    global_target_stock:
      input.globalTargetStock === null || input.globalTargetStock === undefined
        ? null
        : normalizeQuantity(input.globalTargetStock),
    track_quantity: input.trackQuantity ?? true,
    track_individual_assets:
      input.trackIndividualAssets ?? ['asset', 'tool'].includes(input.itemType),
    notes: cleanText(input.notes),
  };

  const query = input.id
    ? admin
        .from('inventory_items')
        .update(payload)
        .eq('id', input.id)
        .eq('organization_id', auth.context.orgId)
    : admin.from('inventory_items').insert({
        ...payload,
        created_by: auth.context.userId,
      });

  const { data, error } = await query.select().single();
  if (error || !data) {
    console.error('Error upserting inventory item:', error);
    return { success: false, error: 'save_failed' };
  }

  const item = toInventoryItem(data as InventoryItemRow);
  const barcode = cleanText(input.barcode);
  if (barcode) {
    const { data: existingBarcode } = await admin
      .from('inventory_item_barcodes')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('barcode_value', barcode)
      .maybeSingle();

    if (!existingBarcode) {
      const { error: barcodeError } = await admin.from('inventory_item_barcodes').insert({
        organization_id: auth.context.orgId,
        item_id: item.id,
        barcode_value: barcode,
        barcode_type: 'unknown',
        is_primary: true,
      });

      if (barcodeError) {
        console.error('Error saving inventory barcode:', barcodeError);
      }
    }
  }

  if (!input.id && initialQuantity > 0 && initialLocationId) {
    const movement = await recordMovement(admin, auth.context, {
      itemId: item.id,
      locationId: initialLocationId,
      movementType: 'initial_count',
      quantityDelta: initialQuantity,
      reason: 'Erstbestand beim Anlegen',
    });

    if (!movement.success) return movement;
  }

  invalidateInventory(auth.context.orgId);
  return { success: true, item };
}

export async function adjustInventoryStock(
  input: AdjustInventoryStockInput
): Promise<ActionResult<{ quantityAfter: number }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const explicitDelta =
    input.quantityDelta !== undefined && Number.isFinite(input.quantityDelta)
      ? input.quantityDelta
      : null;
  const positiveQuantity = normalizeQuantity(input.quantity ?? 0);
  const quantityDelta =
    explicitDelta !== null
      ? explicitDelta
      : input.direction === 'remove'
        ? -positiveQuantity
        : positiveQuantity;

  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    return { success: false, error: 'quantity_required' };
  }
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const result = await recordMovement(admin, auth.context, {
    itemId: input.itemId,
    locationId: input.locationId,
    movementType: quantityDelta > 0 ? 'stock_in' : 'stock_out',
    quantityDelta,
    reason: input.reason || 'Manuelle Bestandsänderung',
  });

  if (!result.success) return result;

  invalidateInventory(auth.context.orgId);
  return result;
}

export async function createJobMaterialLine(
  input: CreateJobMaterialLineInput
): Promise<ActionResult<{ line: JobMaterialLine }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, input.jobId);
  if (!jobContext.success) return jobContext;

  const plannedQuantity = normalizeQuantity(input.plannedQuantity);
  if (plannedQuantity <= 0) return { success: false, error: 'quantity_required' };

  const { data: itemRow } = await admin
    .from('inventory_items')
    .select('*')
    .eq('id', input.itemId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
  if (!item) return { success: false, error: 'item_not_found' };

  const locationReference = await resolveInventoryOrganizationReference(
    admin,
    'inventory_locations',
    auth.context.orgId,
    input.preferredLocationId,
    'location_not_found'
  );
  if (!locationReference.success) return locationReference;

  const { data, error } = await admin
    .from('job_material_lines')
    .insert({
      organization_id: auth.context.orgId,
      job_id: jobContext.job.id,
      project_id: jobContext.job.project_id,
      item_id: item.id,
      preferred_location_id: locationReference.referenceId,
      planned_quantity: plannedQuantity,
      is_billable: item.isBillable,
      notes: cleanText(input.notes),
      created_by: auth.context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error creating job material line:', error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');

  const lines = await hydrateJobMaterialLines(admin, auth.context.orgId, [data as JobMaterialLineRow]);
  return { success: true, line: lines[0] };
}

export async function createProjectMaterialLine(
  input: CreateProjectMaterialLineInput
): Promise<ActionResult<{ line: JobMaterialLine }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, input.projectId);
  if (!projectContext.success) return projectContext;

  const plannedQuantity = normalizeQuantity(input.plannedQuantity);
  if (plannedQuantity <= 0) return { success: false, error: 'quantity_required' };

  const { data: itemRow } = await admin
    .from('inventory_items')
    .select('*')
    .eq('id', input.itemId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
  if (!item) return { success: false, error: 'item_not_found' };

  const locationReference = await resolveInventoryOrganizationReference(
    admin,
    'inventory_locations',
    auth.context.orgId,
    input.preferredLocationId,
    'location_not_found'
  );
  if (!locationReference.success) return locationReference;

  const { data, error } = await admin
    .from('job_material_lines')
    .insert({
      organization_id: auth.context.orgId,
      job_id: null,
      project_id: projectContext.project.id,
      item_id: item.id,
      preferred_location_id: locationReference.referenceId,
      planned_quantity: plannedQuantity,
      is_billable: item.isBillable,
      notes: cleanText(input.notes),
      created_by: auth.context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error creating project material line:', error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.projects(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');

  const lines = await hydrateJobMaterialLines(admin, auth.context.orgId, [data as JobMaterialLineRow]);
  return { success: true, line: lines[0] };
}

export async function updateJobMaterialLine(
  input: UpdateJobMaterialLineInput
): Promise<ActionResult<{ line: JobMaterialLine }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from('job_material_lines')
    .select('*')
    .eq('id', input.lineId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  if (!existing) return { success: false, error: 'line_not_found' };

  const updateData: Record<string, unknown> = {};
  if (input.itemId !== undefined && input.itemId !== existing.item_id) {
    const existingLine = existing as JobMaterialLineRow;
    const hasMovement =
      toNumber(existingLine.taken_quantity) > 0 ||
      toNumber(existingLine.returned_quantity) > 0;

    if (hasMovement) {
      return { success: false, error: 'line_has_movements' };
    }

    const { data: itemRow } = await admin
      .from('inventory_items')
      .select('*')
      .eq('id', input.itemId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle();

    const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
    if (!item) return { success: false, error: 'item_not_found' };

    updateData.item_id = item.id;
    updateData.is_billable = item.isBillable;
  }
  if (input.preferredLocationId !== undefined) {
    const locationReference = await resolveInventoryOrganizationReference(
      admin,
      'inventory_locations',
      auth.context.orgId,
      input.preferredLocationId,
      'location_not_found'
    );
    if (!locationReference.success) return locationReference;
    updateData.preferred_location_id = locationReference.referenceId;
  }
  if (input.plannedQuantity !== undefined) {
    updateData.planned_quantity = normalizeQuantity(input.plannedQuantity);
  }
  if (input.isBillable !== undefined) {
    updateData.is_billable = input.isBillable;
  }
  if (input.notes !== undefined) {
    updateData.notes = cleanText(input.notes);
  }

  if (Object.keys(updateData).length === 0) {
    return { success: false, error: 'no_changes' };
  }

  const { data, error } = await admin
    .from('job_material_lines')
    .update(updateData)
    .eq('id', input.lineId)
    .eq('organization_id', auth.context.orgId)
    .select()
    .single();

  if (error || !data) {
    console.error('Error updating job material line:', error);
    return { success: false, error: 'update_failed' };
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');

  const lines = await hydrateJobMaterialLines(admin, auth.context.orgId, [data as JobMaterialLineRow]);
  return { success: true, line: lines[0] };
}

export async function deleteJobMaterialLine(
  lineId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from('job_material_lines')
    .select('*')
    .eq('id', lineId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  const line = asRow<JobMaterialLineRow>(existing);
  if (!line) return { success: false, error: 'line_not_found' };

  const hasMovement = toNumber(line.taken_quantity) > 0 || toNumber(line.returned_quantity) > 0;
  const result = hasMovement
    ? await admin
        .from('job_material_lines')
        .update({ status: 'cancelled' })
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId)
    : await admin
        .from('job_material_lines')
        .delete()
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId);

  if (result.error) {
    console.error('Error deleting job material line:', result.error);
    return { success: false, error: 'delete_failed' };
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

export async function getJobMaterialLines(
  jobId: string
): Promise<ActionResult<{ lines: JobMaterialLine[] }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, jobId);
  if (!jobContext.success) return jobContext;

  const { data, error } = await admin
    .from('job_material_lines')
    .select('*')
    .eq('organization_id', auth.context.orgId)
    .eq('job_id', jobId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching job material lines:', error);
    return { success: false, error: 'lines_failed' };
  }

  const lines = await hydrateJobMaterialLines(
    admin,
    auth.context.orgId,
    asRows<JobMaterialLineRow>(data)
  );

  return { success: true, lines };
}

export async function getProjectMaterialSummary(
  projectId: string
): Promise<ActionResult<{ summary: ProjectMaterialSummary }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, projectId);
  if (!projectContext.success) return projectContext;

  const [linesResult, jobsResult] = await Promise.all([
    admin
      .from('job_material_lines')
      .select('*')
      .eq('organization_id', auth.context.orgId)
      .eq('project_id', projectId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true }),
    admin
      .from('jobs')
      .select('id, job_number, title')
      .eq('organization_id', auth.context.orgId)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ]);

  if (linesResult.error) {
    console.error('Error fetching project material lines:', linesResult.error);
    return { success: false, error: 'lines_failed' };
  }
  if (jobsResult.error) {
    console.error('Error fetching project jobs for material summary:', jobsResult.error);
    return { success: false, error: 'jobs_failed' };
  }

  const rows = asRows<JobMaterialLineRow>(linesResult.data);
  const lines = await hydrateJobMaterialLines(admin, auth.context.orgId, rows);
  const directLines = lines.filter((line) => !line.jobId);
  const jobLines = lines.filter((line) => line.jobId);
  const jobs = asRows<{ id: string; job_number: string | null; title: string | null }>(
    jobsResult.data
  );
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const jobGroups = jobs
    .map((job) => ({
      jobId: job.id,
      jobNumber: job.job_number,
      jobTitle: job.title ?? 'Auftrag',
      lines: jobLines.filter((line) => line.jobId === job.id),
    }))
    .filter((group) => group.lines.length > 0);

  for (const line of jobLines) {
    if (line.jobId && !jobMap.has(line.jobId)) {
      jobGroups.push({
        jobId: line.jobId,
        jobNumber: null,
        jobTitle: 'Auftrag',
        lines: [line],
      });
    }
  }

  const totalMap = new Map<string, ProjectMaterialSummary['totals'][number]>();
  for (const line of lines) {
    const key = `${line.itemId}:${line.unit}`;
    const current =
      totalMap.get(key) ??
      {
        itemId: line.itemId,
        itemName: line.itemName,
        unit: line.unit,
        plannedQuantity: 0,
        takenQuantity: 0,
        returnedQuantity: 0,
      };
    current.plannedQuantity += line.plannedQuantity;
    current.takenQuantity += line.takenQuantity;
    current.returnedQuantity += line.returnedQuantity;
    totalMap.set(key, current);
  }

  return {
    success: true,
    summary: {
      directLines,
      jobGroups,
      totals: Array.from(totalMap.values()).sort((a, b) =>
        a.itemName.localeCompare(b.itemName, 'de')
      ),
    },
  };
}

async function hydrateJobMaterialLines(
  admin: SupabaseAdminClient,
  orgId: string,
  rows: JobMaterialLineRow[]
): Promise<JobMaterialLine[]> {
  if (rows.length === 0) return [];

  const itemIds = Array.from(new Set(rows.map((line) => line.item_id)));
  const locationIds = Array.from(
    new Set(rows.map((line) => line.preferred_location_id).filter(Boolean))
  ) as string[];

  const [itemsResult, categoriesResult, locationsResult, stockResult] = await Promise.all([
    admin.from('inventory_items').select('*').eq('organization_id', orgId).in('id', itemIds),
    admin.from('inventory_categories').select('*').eq('organization_id', orgId),
    locationIds.length > 0
      ? admin.from('inventory_locations').select('*').eq('organization_id', orgId).in('id', locationIds)
      : Promise.resolve({ data: [] }),
    admin.from('inventory_stock_levels').select('*').eq('organization_id', orgId).in('item_id', itemIds),
  ]);

  const items = asRows<InventoryItemRow>(itemsResult.data).map(toInventoryItem);
  const categories = asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory);
  const locations = asRows<InventoryLocationRow>(locationsResult.data).map(toInventoryLocation);
  const stockLevels = asRows<InventoryStockLevelRow>(stockResult.data);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));

  const stockByItem = new Map<string, number>();
  for (const stock of stockLevels) {
    stockByItem.set(
      stock.item_id,
      (stockByItem.get(stock.item_id) ?? 0) + toNumber(stock.quantity_on_hand)
    );
  }

  return rows.flatMap((line) => {
    const item = itemMap.get(line.item_id);
    if (!item) return [];

    return [
      {
        id: line.id,
        jobId: line.job_id,
        projectId: line.project_id,
        itemId: line.item_id,
        itemName: item.name,
        itemType: item.itemType,
        unit: item.unit,
        categoryName: item.categoryId ? categoryMap.get(item.categoryId)?.name ?? null : null,
        preferredLocationId: line.preferred_location_id,
        preferredLocationName: line.preferred_location_id
          ? locationMap.get(line.preferred_location_id)?.name ?? null
          : null,
        plannedQuantity: toNumber(line.planned_quantity),
        takenQuantity: toNumber(line.taken_quantity),
        returnedQuantity: toNumber(line.returned_quantity),
        billableQuantity: toNumber(line.billable_quantity),
        isBillable: line.is_billable,
        isUnplanned: line.is_unplanned,
        status: line.status,
        notes: line.notes,
        availableQuantity: stockByItem.get(item.id) ?? 0,
      },
    ];
  });
}

export async function takeJobMaterial(
  input: TakeJobMaterialInput
): Promise<ActionResult<{ quantityAfter: number }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, input.jobId);
  if (!jobContext.success) return jobContext;

  let lineId = input.lineId ?? null;
  let itemId = input.itemId ?? null;
  let createdLineId: string | null = null;

  if (lineId) {
    const { data: line } = await admin
      .from('job_material_lines')
      .select('*')
      .eq('id', lineId)
      .eq('organization_id', auth.context.orgId)
      .eq('job_id', input.jobId)
      .maybeSingle();
    const existingLine = asRow<JobMaterialLineRow>(line);
    if (!existingLine) return { success: false, error: 'line_not_found' };
    itemId = existingLine.item_id;
  } else {
    if (!itemId) return { success: false, error: 'item_required' };

    const { data: itemRow } = await admin
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle();
    const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
    if (!item) return { success: false, error: 'item_not_found' };

    const { data: newLine, error: lineError } = await admin
      .from('job_material_lines')
      .insert({
        organization_id: auth.context.orgId,
        job_id: jobContext.job.id,
        project_id: jobContext.job.project_id,
        item_id: item.id,
        preferred_location_id: input.locationId,
        planned_quantity: 0,
        is_billable: item.isBillable,
        is_unplanned: true,
        notes: cleanText(input.reason),
        created_by: auth.context.userId,
      })
      .select('id')
      .single();

    if (lineError || !newLine) {
      console.error('Error creating unplanned material line:', lineError);
      return { success: false, error: 'line_create_failed' };
    }

    lineId = asRow<{ id: string }>(newLine)?.id ?? null;
    createdLineId = lineId;
  }

  if (!itemId || !lineId) return { success: false, error: 'line_not_found' };

  const result = await recordMovement(admin, auth.context, {
    itemId,
    locationId: input.locationId,
    movementType: 'job_take',
    quantityDelta: -quantity,
    jobId: jobContext.job.id,
    projectId: jobContext.job.project_id,
    jobMaterialLineId: lineId,
    reason: input.reason || 'Für Auftrag entnommen',
  });

  if (!result.success) {
    if (createdLineId) {
      await deleteFailedUnplannedMaterialLine(admin, auth.context.orgId, createdLineId);
    }
    return result;
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');
  return result;
}

export async function takeProjectMaterial(
  input: Omit<TakeJobMaterialInput, 'jobId'> & { projectId: string }
): Promise<ActionResult<{ quantityAfter: number }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, input.projectId);
  if (!projectContext.success) return projectContext;

  let lineId = input.lineId ?? null;
  let itemId = input.itemId ?? null;
  let createdLineId: string | null = null;

  if (lineId) {
    const { data: line } = await admin
      .from('job_material_lines')
      .select('*')
      .eq('id', lineId)
      .eq('organization_id', auth.context.orgId)
      .eq('project_id', input.projectId)
      .is('job_id', null)
      .maybeSingle();
    const existingLine = asRow<JobMaterialLineRow>(line);
    if (!existingLine) return { success: false, error: 'line_not_found' };
    itemId = existingLine.item_id;
  } else {
    if (!itemId) return { success: false, error: 'item_required' };

    const { data: itemRow } = await admin
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle();
    const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
    if (!item) return { success: false, error: 'item_not_found' };

    const { data: newLine, error: lineError } = await admin
      .from('job_material_lines')
      .insert({
        organization_id: auth.context.orgId,
        job_id: null,
        project_id: projectContext.project.id,
        item_id: item.id,
        preferred_location_id: input.locationId,
        planned_quantity: 0,
        is_billable: item.isBillable,
        is_unplanned: true,
        notes: cleanText(input.reason),
        created_by: auth.context.userId,
      })
      .select('id')
      .single();

    if (lineError || !newLine) {
      console.error('Error creating direct project material line:', lineError);
      return { success: false, error: 'line_create_failed' };
    }

    lineId = asRow<{ id: string }>(newLine)?.id ?? null;
    createdLineId = lineId;
  }

  if (!itemId || !lineId) return { success: false, error: 'line_not_found' };

  const result = await recordMovement(admin, auth.context, {
    itemId,
    locationId: input.locationId,
    movementType: 'job_take',
    quantityDelta: -quantity,
    projectId: projectContext.project.id,
    jobMaterialLineId: lineId,
    reason: input.reason || 'Für Projekt entnommen',
  });

  if (!result.success) {
    if (createdLineId) {
      await deleteFailedUnplannedMaterialLine(admin, auth.context.orgId, createdLineId);
    }
    return result;
  }

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.projects(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');
  return result;
}

export async function returnJobMaterial(
  input: ReturnJobMaterialInput
): Promise<ActionResult<{ quantityAfter: number }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };

  const admin = createSupabaseAdminClient();
  const { data: lineData } = await admin
    .from('job_material_lines')
    .select('*')
    .eq('id', input.lineId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();

  const line = asRow<JobMaterialLineRow>(lineData);
  if (!line) return { success: false, error: 'line_not_found' };

  let jobId: string | null = null;
  let projectId: string | null = null;

  if (line.job_id) {
    const jobContext = await getJobContext(admin, auth.context, line.job_id);
    if (!jobContext.success) return jobContext;
    jobId = jobContext.job.id;
    projectId = jobContext.job.project_id;
  } else if (line.project_id) {
    const projectContext = await getProjectContext(admin, auth.context, line.project_id);
    if (!projectContext.success) return projectContext;
    projectId = projectContext.project.id;
  } else {
    return { success: false, error: 'line_not_found' };
  }

  const stillOut = toNumber(line.taken_quantity) - toNumber(line.returned_quantity);
  if (quantity > stillOut) {
    return { success: false, error: 'return_exceeds_taken' };
  }

  const result = await recordMovement(admin, auth.context, {
    itemId: line.item_id,
    locationId: input.locationId,
    movementType: 'job_return',
    quantityDelta: quantity,
    jobId,
    projectId,
    jobMaterialLineId: line.id,
    reason: input.reason || (jobId ? 'Von Auftrag zurückgelegt' : 'Von Projekt zurückgelegt'),
  });

  if (!result.success) return result;

  invalidateInventory(auth.context.orgId);
  updateTag(CACHE_TAGS.projects(auth.context.orgId));
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  revalidatePath('/auftraege', 'layout');
  return result;
}

export async function importInventoryRows(
  input: ImportInventoryRowsInput
): Promise<ActionResult<{ importedCount: number; failedCount: number }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const fileName = cleanText(input.fileName) ?? 'inventar-import.csv';
  const rows = input.rows.filter((row) => cleanText(row.name));
  if (rows.length === 0) return { success: false, error: 'no_rows' };

  const admin = createSupabaseAdminClient();
  await ensureInventoryDefaults(admin, auth.context);

  const { data: batchData, error: batchError } = await admin
    .from('inventory_import_batches')
    .insert({
      organization_id: auth.context.orgId,
      file_name: fileName,
      status: 'draft',
      column_mapping: input.columnMapping,
      row_count: rows.length,
      created_by: auth.context.userId,
    })
    .select('id')
    .single();

  const batch = asRow<{ id: string }>(batchData);
  if (batchError || !batch) {
    console.error('Error creating inventory import batch:', batchError);
    return { success: false, error: 'batch_failed' };
  }

  let importedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    try {
      const name = cleanText(row.name);
      if (!name) {
        failedCount++;
        continue;
      }

      const categoryId = await ensureCategory(admin, auth.context.orgId, row.categoryName);
      const supplierId = await ensureSupplier(
        admin,
        auth.context.orgId,
        null,
        row.supplierName
      );
      const locationId = await ensureLocation(admin, auth.context, row.locationName);

      let itemId: string | null = null;
      const internalSku = cleanText(row.internalSku);
      const barcode = cleanText(row.barcode);

      if (internalSku) {
        const { data: existing } = await admin
          .from('inventory_items')
          .select('id')
          .eq('organization_id', auth.context.orgId)
          .eq('internal_sku', internalSku)
          .maybeSingle();
        itemId = asRow<{ id: string }>(existing)?.id ?? null;
      }

      if (!itemId && barcode) {
        const { data: existingBarcode } = await admin
          .from('inventory_item_barcodes')
          .select('item_id')
          .eq('organization_id', auth.context.orgId)
          .eq('barcode_value', barcode)
          .maybeSingle();
        itemId = asRow<{ item_id: string }>(existingBarcode)?.item_id ?? null;
      }

      if (!itemId) {
        const { data: insertedItem, error: itemError } = await admin
          .from('inventory_items')
          .insert({
            organization_id: auth.context.orgId,
            item_type: row.itemType ?? 'material',
            name,
            category_id: categoryId,
            unit: normalizeInventoryUnitInput(row.unit),
            internal_sku: internalSku,
            manufacturer: cleanText(row.manufacturer),
            supplier_id: supplierId,
            supplier_article_number: cleanText(row.supplierArticleNumber),
            purchase_price_cents: normalizePrice(row.purchasePriceCents),
            sale_price_cents: normalizePrice(row.salePriceCents),
            is_billable: row.isBillable ?? true,
            global_minimum_stock: normalizeQuantity(row.minimumStock ?? 0),
            global_target_stock:
              row.targetStock === null || row.targetStock === undefined
                ? null
                : normalizeQuantity(row.targetStock),
            notes: cleanText(row.notes),
            created_by: auth.context.userId,
          })
          .select('id')
          .single();

        if (itemError || !insertedItem) {
          console.error('Error importing inventory item:', itemError);
          failedCount++;
          continue;
        }

        itemId = asRow<{ id: string }>(insertedItem)?.id ?? null;
      }

      if (!itemId) {
        failedCount++;
        continue;
      }

      if (barcode) {
        const { data: existingBarcode } = await admin
          .from('inventory_item_barcodes')
          .select('id')
          .eq('organization_id', auth.context.orgId)
          .eq('barcode_value', barcode)
          .maybeSingle();

        if (!existingBarcode) {
          await admin.from('inventory_item_barcodes').insert({
            organization_id: auth.context.orgId,
            item_id: itemId,
            barcode_value: barcode,
            barcode_type: 'unknown',
            is_primary: true,
          });
        }
      }

      const quantity = normalizeQuantity(row.quantity ?? 0);
      if (locationId && quantity > 0) {
        const movement = await recordMovement(admin, auth.context, {
          itemId,
          locationId,
          movementType: 'initial_count',
          quantityDelta: quantity,
          importBatchId: batch.id,
          reason: `CSV-Import: ${fileName}`,
        });

        if (!movement.success) {
          failedCount++;
          continue;
        }
      }

      importedCount++;
    } catch (error) {
      console.error('Unexpected row import error:', error);
      failedCount++;
    }
  }

  const { error: updateError } = await admin
    .from('inventory_import_batches')
    .update({
      status: failedCount > 0 ? 'failed' : 'imported',
      imported_count: importedCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  if (updateError) {
    console.error('Error updating inventory import batch:', updateError);
  }

  invalidateInventory(auth.context.orgId);
  return { success: true, importedCount, failedCount };
}
