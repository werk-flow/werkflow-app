import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logReadErrors } from '@/lib/data/read-request-cache';
import type {
  InventoryBarcodeRow,
  InventoryCategory,
  InventoryCategoryRow,
  InventoryItem,
  InventoryItemRow,
  InventoryLocation,
  InventoryLocationRow,
  InventoryMovementListItem,
  InventoryMovementRow,
  InventoryOverviewItem,
  InventoryPickerOption,
  InventoryStockLevelRow,
  InventoryStockStatus,
  InventorySupplier,
  InventorySupplierRow,
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

// The catalog reads behind the inventory Server Actions in `./actions`. The
// callers authorize the organization first; every read here keeps the
// organization filter as the tenant boundary.

export type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function getStockStatus(item: InventoryItem, totalOnHand: number): InventoryStockStatus {
  if (!item.trackQuantity) return 'in_stock';
  if (totalOnHand <= 0) return 'out_of_stock';
  if (item.globalMinimumStock > 0 && totalOnHand <= item.globalMinimumStock) {
    return 'low_stock';
  }
  return 'in_stock';
}

function readInventoryOverviewSupportRows(
  admin: SupabaseAdminClient,
  orgId: string,
  supportIds: string[],
  jobIds: string[],
  projectIds: string[],
) {
  return Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('inventory_categories')
          .select('*')
          .eq('organization_id', orgId)
          .order('sort_order')
          .order('name')
          .order('id')
          .range(from, to),
      1000,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('inventory_locations')
          .select('*')
          .eq('organization_id', orgId)
          .order('sort_order')
          .order('name')
          .order('id')
          .range(from, to),
      1000,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('inventory_suppliers')
          .select('*')
          .eq('organization_id', orgId)
          .order('name')
          .order('id')
          .range(from, to),
      1000,
    ),
    readInBatches(supportIds, (batch) =>
      admin
        .from('inventory_items')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(supportIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_barcodes')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('is_primary', { ascending: false })
            .order('id')
            .range(from, to),
        10000,
      ),
    ),
    readInBatches(supportIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_stock_levels')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('id')
            .range(from, to),
        10000,
      ),
    ),
    readInBatches(supportIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('job_material_lines')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .neq('status', 'cancelled')
            .order('id')
            .range(from, to),
        10000,
      ),
    ),
    readInBatches(supportIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_asset_instances')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('id')
            .range(from, to),
        10000,
      ),
    ),
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, project_number, name')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
}

function groupRowsByItem<Row extends { item_id: string }>(rows: Row[]): Map<string, Row[]> {
  const rowsByItem = new Map<string, Row[]>();
  for (const row of rows) {
    const list = rowsByItem.get(row.item_id) ?? [];
    list.push(row);
    rowsByItem.set(row.item_id, list);
  }
  return rowsByItem;
}

function toInventoryOverviewItems(
  pageIds: string[],
  itemMap: Map<string, InventoryItem>,
  categoryMap: Map<string, InventoryCategory>,
  locationMap: Map<string, InventoryLocation>,
  supplierMap: Map<string, InventorySupplier>,
  barcodes: InventoryBarcodeRow[],
  stockLevels: InventoryStockLevelRow[],
  materialLines: JobMaterialLineRow[],
  assetInstances: InventoryAssetInstanceRow[],
): InventoryOverviewItem[] {
  const barcodesByItem = groupRowsByItem(barcodes);
  const stockByItem = groupRowsByItem(stockLevels);

  const plannedByItem = new Map<string, number>();
  for (const line of materialLines) {
    const plannedOpen = Math.max(0, toNumber(line.planned_quantity) - toNumber(line.taken_quantity));
    plannedByItem.set(line.item_id, (plannedByItem.get(line.item_id) ?? 0) + plannedOpen);
  }

  const assetCountByItem = new Map<string, number>();
  for (const asset of assetInstances) {
    assetCountByItem.set(asset.item_id, (assetCountByItem.get(asset.item_id) ?? 0) + 1);
  }

  // The page is the filtered, ordered id list; movement-only items feed the lookups above but are not page rows.
  return pageIds.flatMap((id) => {
    const item = itemMap.get(id);
    if (!item) return [];
    const itemStock = stockByItem.get(item.id) ?? [];
    const stockByLocation = itemStock.map((stock) => ({
      locationId: stock.location_id,
      locationName: locationMap.get(stock.location_id)?.name ?? 'Unbekanntes Lager',
      quantityOnHand: toNumber(stock.quantity_on_hand),
    }));
    const totalOnHand = stockByLocation.reduce((sum, stock) => sum + stock.quantityOnHand, 0);
    const plannedQuantity = plannedByItem.get(item.id) ?? 0;
    const itemBarcodes = barcodesByItem.get(item.id) ?? [];
    const primaryBarcode =
      itemBarcodes.find((barcode) => barcode.is_primary)?.barcode_value ??
      itemBarcodes[0]?.barcode_value ??
      null;

    return [
      {
        ...item,
        categoryName: item.categoryId ? (categoryMap.get(item.categoryId)?.name ?? null) : null,
        supplierName: item.supplierId ? (supplierMap.get(item.supplierId)?.name ?? null) : null,
        primaryBarcode,
        barcodes: itemBarcodes.map((barcode) => barcode.barcode_value),
        totalOnHand,
        plannedQuantity,
        availableQuantity: Math.max(0, totalOnHand - plannedQuantity),
        stockStatus: getStockStatus(item, totalOnHand),
        stockByLocation,
        assetInstanceCount: assetCountByItem.get(item.id) ?? 0,
      },
    ];
  });
}

/**
 * Reads everything the inventory page shows beside the page ids and the latest
 * movements: the catalog lookups and the support rows of the listed and moved
 * items. Returns `inventory_failed` when any read fails.
 */
export async function loadInventoryOverviewLists(
  admin: SupabaseAdminClient,
  orgId: string,
  page: { ids: string[]; supportIds: string[] },
  movements: InventoryMovementRow[],
): Promise<
  ActionResult<{
    categories: InventoryCategory[];
    locations: InventoryLocation[];
    suppliers: InventorySupplier[];
    items: InventoryOverviewItem[];
    movements: InventoryMovementListItem[];
  }>
> {
  const supportIds = [...new Set([...page.supportIds, ...movements.map((movement) => movement.item_id)])];
  const jobIds = [...new Set(movements.flatMap((row) => (row.job_id ? [row.job_id] : [])))];
  const projectIds = [...new Set(movements.flatMap((row) => (row.project_id ? [row.project_id] : [])))];
  const supportResults = await readInventoryOverviewSupportRows(admin, orgId, supportIds, jobIds, projectIds);
  const [
    categoriesResult,
    locationsResult,
    suppliersResult,
    itemsResult,
    barcodesResult,
    stockLevelsResult,
    materialLinesResult,
    assetInstancesResult,
    jobsResult,
    projectsResult,
  ] = supportResults;
  if (supportResults.some((result) => result.error)) {
    logReadErrors('getInventoryOverview: read failed', ...supportResults.map((result) => result.error));
    return { success: false, error: 'inventory_failed' };
  }

  const categories = asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory);
  const locations = asRows<InventoryLocationRow>(locationsResult.data).map(toInventoryLocation);
  const suppliers = asRows<InventorySupplierRow>(suppliersResult.data).map(toInventorySupplier);
  const items = asRows<InventoryItemRow>(itemsResult.data).map(toInventoryItem);
  const jobs = asRows<{ id: string; job_number: string | null; title: string }>(jobsResult.data);
  const projects = asRows<{ id: string; project_number: string | null; name: string }>(projectsResult.data);

  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const overviewItems = toInventoryOverviewItems(
    page.ids,
    itemMap,
    categoryMap,
    locationMap,
    supplierMap,
    asRows<InventoryBarcodeRow>(barcodesResult.data),
    asRows<InventoryStockLevelRow>(stockLevelsResult.data),
    asRows<JobMaterialLineRow>(materialLinesResult.data),
    asRows<InventoryAssetInstanceRow>(assetInstancesResult.data),
  );

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
    jobTitle: movement.job_id ? (jobMap.get(movement.job_id)?.title ?? null) : null,
    jobNumber: movement.job_id ? (jobMap.get(movement.job_id)?.job_number ?? null) : null,
    projectId: movement.project_id,
    projectName: movement.project_id ? (projectMap.get(movement.project_id)?.name ?? null) : null,
    projectNumber: movement.project_id ? (projectMap.get(movement.project_id)?.project_number ?? null) : null,
    reason: movement.reason,
    createdAt: movement.created_at,
  }));

  return { success: true, categories, locations, suppliers, items: overviewItems, movements: movementItems };
}

/** The ids a picker search matches by name, SKU, manufacturer, or barcode, plus the barcode each matched by. */
async function searchInventoryPickerItemIds(
  admin: SupabaseAdminClient,
  orgId: string,
  searchTerm: string,
  itemLimit: number | undefined,
): Promise<ActionResult<{ itemIds: string[]; matchedBarcodeByItem: Map<string, string> }>> {
  const matchedBarcodeByItem = new Map<string, string>();
  const pattern = `%${searchTerm}%`;
  const [names, skus, manufacturers, barcodes] = await Promise.all([
    admin
      .from('inventory_items')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .ilike('name', pattern)
      .limit(itemLimit ?? 50),
    admin
      .from('inventory_items')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .ilike('internal_sku', pattern)
      .limit(itemLimit ?? 50),
    admin
      .from('inventory_items')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .ilike('manufacturer', pattern)
      .limit(itemLimit ?? 50),
    admin
      .from('inventory_item_barcodes')
      .select('item_id, barcode_value')
      .eq('organization_id', orgId)
      .ilike('barcode_value', pattern)
      .limit(itemLimit ?? 50),
  ]);
  const searchResults = [names, skus, manufacturers, barcodes];
  if (searchResults.some((result) => result.error)) {
    logReadErrors(
      'loadInventoryPickerOptions: search read failed',
      ...searchResults.map((result) => result.error),
    );
    return { success: false, error: 'items_failed' };
  }
  for (const barcode of barcodes.data ?? []) {
    if (!matchedBarcodeByItem.has(barcode.item_id)) {
      matchedBarcodeByItem.set(barcode.item_id, barcode.barcode_value);
    }
  }
  const itemIds = Array.from(
    new Set([
      ...(barcodes.data ?? []).map((row) => row.item_id),
      ...(skus.data ?? []).map((row) => row.id),
      ...(names.data ?? []).map((row) => row.id),
      ...(manufacturers.data ?? []).map((row) => row.id),
    ]),
  ).slice(0, itemLimit ?? 50);
  return { success: true, itemIds, matchedBarcodeByItem };
}

/** The category, supplier, stock, and barcode rows of the loaded picker items, or the first failing read's code. */
async function readInventoryPickerSupportRows(
  admin: SupabaseAdminClient,
  orgId: string,
  itemRows: InventoryItemRow[],
  includeOfficeDetails: boolean,
): Promise<
  ActionResult<{
    categories: InventoryCategory[];
    suppliers: InventorySupplier[];
    stockRows: InventoryStockLevelRow[];
    barcodeRows: InventoryBarcodeRow[];
  }>
> {
  const loadedItemIds = itemRows.map((item) => item.id);
  const categoryIds = Array.from(
    new Set(itemRows.flatMap((item) => (item.category_id ? [item.category_id] : []))),
  );
  const supplierIds = Array.from(
    new Set(itemRows.flatMap((item) => (item.supplier_id ? [item.supplier_id] : []))),
  );
  const [categoriesResult, suppliersResult, stockResult, barcodesResult] = await Promise.all([
    readInBatches(categoryIds, (batch) =>
      admin
        .from('inventory_categories')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(includeOfficeDetails ? supplierIds : [], (batch) =>
      admin
        .from('inventory_suppliers')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(loadedItemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_stock_levels')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    // Each batch holds whole items, so the primary-first order per item survives.
    readInBatches(loadedItemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_barcodes')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('is_primary', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (categoriesResult.error) {
    logReadErrors('loadInventoryPickerOptions: read failed', categoriesResult.error);
    return { success: false, error: 'categories_failed' };
  }
  if (suppliersResult.error) {
    logReadErrors('loadInventoryPickerOptions: read failed', suppliersResult.error);
    return { success: false, error: 'suppliers_failed' };
  }
  if (stockResult.error) {
    logReadErrors('loadInventoryPickerOptions: read failed', stockResult.error);
    return { success: false, error: 'stock_failed' };
  }
  if (barcodesResult.error) {
    logReadErrors('loadInventoryPickerOptions: read failed', barcodesResult.error);
    return { success: false, error: 'barcodes_failed' };
  }

  return {
    success: true,
    categories: asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory),
    suppliers: asRows<InventorySupplierRow>(suppliersResult.data).map(toInventorySupplier),
    stockRows: asRows<InventoryStockLevelRow>(stockResult.data),
    barcodeRows: asRows<InventoryBarcodeRow>(barcodesResult.data),
  };
}

function toInventoryPickerOptions(
  itemRows: InventoryItemRow[],
  locations: InventoryLocation[],
  support: {
    categories: InventoryCategory[];
    suppliers: InventorySupplier[];
    stockRows: InventoryStockLevelRow[];
    barcodeRows: InventoryBarcodeRow[];
  },
  matchedBarcodeByItem: Map<string, string>,
  includeOfficeDetails: boolean,
): InventoryPickerOption[] {
  const categoryMap = new Map(support.categories.map((category) => [category.id, category]));
  const supplierMap = new Map(support.suppliers.map((supplier) => [supplier.id, supplier]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const barcodesByItem = groupRowsByItem(support.barcodeRows);
  const stockByItem = groupRowsByItem(support.stockRows);

  return itemRows.map((row) => {
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
      supplierName:
        includeOfficeDetails && item.supplierId ? (supplierMap.get(item.supplierId)?.name ?? null) : null,
      supplierArticleNumber: includeOfficeDetails ? item.supplierArticleNumber : null,
      primaryBarcode:
        matchedBarcodeByItem.get(item.id) ??
        barcodesByItem.get(item.id)?.find((barcode) => barcode.is_primary)?.barcode_value ??
        barcodesByItem.get(item.id)?.[0]?.barcode_value ??
        null,
      categoryName: item.categoryId ? (categoryMap.get(item.categoryId)?.name ?? null) : null,
      isBillable: includeOfficeDetails && item.isBillable,
      availableQuantity: stockByLocation.reduce((sum, stock) => sum + stock.quantityOnHand, 0),
      stockByLocation,
    };
  });
}

/** The organization's active storage locations in their display order; a company holds a handful. */
export async function loadActiveInventoryLocations(
  admin: SupabaseAdminClient,
  orgId: string,
): Promise<ActionResult<{ locations: InventoryLocation[] }>> {
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('inventory_locations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadErrors('loadActiveInventoryLocations: read failed', error);
    return { success: false, error: 'locations_failed' };
  }
  return { success: true, locations: asRows<InventoryLocationRow>(data).map(toInventoryLocation) };
}

/** One bounded page of the picker catalog: the first `itemLimit` items, the matches of a search, or one item. */
export async function loadInventoryPickerOptions(
  admin: SupabaseAdminClient,
  orgId: string,
  includeOfficeDetails: boolean,
  options: { searchTerm?: string; itemLimit: number; exactItemId?: string | undefined },
): Promise<ActionResult<{ items: InventoryPickerOption[]; locations: InventoryLocation[] }>> {
  const searchTerm = options.searchTerm?.trim().slice(0, 80) ?? '';
  const itemLimit = options.itemLimit;
  let itemIds: string[] | null = options.exactItemId ? [options.exactItemId] : null;
  let matchedBarcodeByItem = new Map<string, string>();

  if (!options.exactItemId && searchTerm) {
    const search = await searchInventoryPickerItemIds(admin, orgId, searchTerm, itemLimit);
    if (!search.success) return search;
    itemIds = search.itemIds;
    matchedBarcodeByItem = search.matchedBarcodeByItem;
  }

  const activeItems = () =>
    admin
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .order('id');
  // A search holds at most `itemLimit` ids (one batch, so the name order holds).
  const [itemsResult, locationsResult] = await Promise.all([
    itemIds
      ? readInBatches(itemIds, (batch) => activeItems().in('id', [...batch]))
      : activeItems().limit(itemLimit),
    loadActiveInventoryLocations(admin, orgId),
  ]);

  if (itemsResult.error) {
    logReadErrors('loadInventoryPickerOptions: read failed', itemsResult.error);
    return { success: false, error: 'items_failed' };
  }
  if (!locationsResult.success) return locationsResult;

  const itemRows = asRows<InventoryItemRow>(itemsResult.data);
  const support = await readInventoryPickerSupportRows(admin, orgId, itemRows, includeOfficeDetails);
  if (!support.success) return support;

  const { locations } = locationsResult;
  const pickerItems = toInventoryPickerOptions(
    itemRows,
    locations,
    support,
    matchedBarcodeByItem,
    includeOfficeDetails,
  );

  return { success: true, items: pickerItems, locations };
}
