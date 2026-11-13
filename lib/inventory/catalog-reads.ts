import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { AdminClient } from '@/lib/supabase/admin';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { formatProfileName } from '@/lib/members/profile-name';
import { inventoryMovementPageResultSchema, type InventoryPageQuery } from './list-page';
import type {
  InventoryBarcodeRow,
  InventoryCategory,
  InventoryItem,
  InventoryItemRow,
  InventoryLocation,
  InventoryMovementPage,
  InventoryOverviewItem,
  InventoryPickerOption,
  InventoryStockLevelRow,
  InventorySupplier,
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
import { inventoryStockFacts } from './stock-facts';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { Database } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import {
  ARTICLE_PRICE_KINDS,
  ARTICLE_PRICE_ORIGINS,
  PRICE_QUANTITIES,
  type ArticleTerms,
  type ArticleTermsPage,
} from './article-price-terms';

// The catalog reads behind the inventory Server Actions in `./actions` and
// `./catalog-actions`. The callers authorize the organization first; every
// read here keeps the organization filter as the tenant boundary.

/** The organization's categories, locations and suppliers in their display order. */
function readInventoryCatalogLookups(admin: AdminClient, orgId: string) {
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
  ]);
}

/** The items with their barcodes, stock levels, open material lines and asset instances. */
function readInventoryItemSupportRows(admin: AdminClient, orgId: string, supportIds: string[]) {
  return Promise.all([
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
  ]);
}

/** Every support read of the inventory page, started together, in one flat result list. */
async function readInventoryOverviewSupportRows(admin: AdminClient, orgId: string, supportIds: string[]) {
  const [lookups, itemRows] = await Promise.all([
    readInventoryCatalogLookups(admin, orgId),
    readInventoryItemSupportRows(admin, orgId, supportIds),
  ]);
  return [...lookups, ...itemRows] as const;
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

  // The page is the filtered, ordered id list; a Lager preview's items feed the lookups above but are not page rows.
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
        ...inventoryStockFacts(item, totalOnHand, plannedQuantity),
        stockByLocation,
        assetInstanceCount: assetCountByItem.get(item.id) ?? 0,
      },
    ];
  });
}

/**
 * Reads everything the inventory page shows beside the page ids: the catalog
 * lookups and the support rows of the listed items. Returns
 * `inventory_failed` when any read fails.
 */
export async function loadInventoryOverviewLists(
  admin: AdminClient,
  orgId: string,
  page: { ids: string[]; supportIds: string[] },
): Promise<
  ActionResult<{
    categories: InventoryCategory[];
    locations: InventoryLocation[];
    suppliers: InventorySupplier[];
    items: InventoryOverviewItem[];
  }>
> {
  const supportResults = await readInventoryOverviewSupportRows(admin, orgId, page.supportIds);
  const [
    categoriesResult,
    locationsResult,
    suppliersResult,
    itemsResult,
    barcodesResult,
    stockLevelsResult,
    materialLinesResult,
    assetInstancesResult,
  ] = supportResults;
  if (supportResults.some((result) => result.error)) {
    logReadErrors('getInventoryOverview: read failed', ...supportResults.map((result) => result.error));
    return { success: false, error: 'inventory_failed' };
  }

  const categories = (categoriesResult.data ?? []).map(toInventoryCategory);
  const locations = (locationsResult.data ?? []).map(toInventoryLocation);
  const suppliers = (suppliersResult.data ?? []).map(toInventorySupplier);
  const items = (itemsResult.data ?? []).map(toInventoryItem);

  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const itemMap = new Map(items.map((item) => [item.id, item]));

  const overviewItems = toInventoryOverviewItems(
    page.ids,
    itemMap,
    categoryMap,
    locationMap,
    supplierMap,
    barcodesResult.data ?? [],
    stockLevelsResult.data ?? [],
    materialLinesResult.data ?? [],
    assetInstancesResult.data ?? [],
  );

  return { success: true, categories, locations, suppliers, items: overviewItems };
}

/**
 * One page of the movement history: stock movements and use events of job
 * material, filtered, counted and ordered in the database
 * (`list_inventory_movement_page`). The caller authorizes Admin or Büro and
 * passes the caller's organization. A failed or malformed read is `failed`,
 * never an empty history.
 */
export async function loadInventoryMovementPage(
  admin: AdminClient,
  orgId: string,
  query: InventoryPageQuery,
): Promise<InventoryMovementPage> {
  const { data, error } = await admin.rpc('list_inventory_movement_page', {
    p_organization_id: orgId,
    p_query: query,
  });
  const parsed = inventoryMovementPageResultSchema.safeParse(data);
  if (error || !parsed.success) {
    logReadErrors('loadInventoryMovementPage: read failed', error ?? { code: 'malformed_result' });
    return { status: 'failed' };
  }
  const people = parsed.data.people.map((person) => ({
    id: person.id,
    name: formatProfileName({
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email,
    }),
  }));
  const nameById = new Map(people.map((person) => [person.id, person.name]));
  return {
    status: 'loaded',
    total: parsed.data.total,
    hasAny: parsed.data.hasAny,
    people,
    entries: parsed.data.rows.map(({ actorId, ...row }) => ({
      ...row,
      actorName: actorId ? (nameById.get(actorId) ?? null) : null,
    })),
  };
}

/** The ids a picker search matches by name, SKU, manufacturer, or barcode, plus the barcode each matched by. */
async function searchInventoryPickerItemIds(
  admin: AdminClient,
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

/** The category, supplier, stock, and barcode reads of the loaded picker items, started together. */
function readInventoryPickerSupportResults(
  admin: AdminClient,
  orgId: string,
  itemRows: InventoryItemRow[],
  includeOfficeDetails: boolean,
) {
  const loadedItemIds = itemRows.map((item) => item.id);
  const categoryIds = Array.from(
    new Set(itemRows.flatMap((item) => (item.category_id ? [item.category_id] : []))),
  );
  const supplierIds = Array.from(
    new Set(itemRows.flatMap((item) => (item.supplier_id ? [item.supplier_id] : []))),
  );
  return Promise.all([
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
}

/** The category, supplier, stock, and barcode rows of the loaded picker items, or the first failing read's code. */
async function readInventoryPickerSupportRows(
  admin: AdminClient,
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
  const [categoriesResult, suppliersResult, stockResult, barcodesResult] =
    await readInventoryPickerSupportResults(admin, orgId, itemRows, includeOfficeDetails);
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
    categories: (categoriesResult.data ?? []).map(toInventoryCategory),
    suppliers: (suppliersResult.data ?? []).map(toInventorySupplier),
    stockRows: stockResult.data ?? [],
    barcodeRows: barcodesResult.data ?? [],
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
  admin: AdminClient,
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
  return { success: true, locations: (data ?? []).map(toInventoryLocation) };
}

/** One bounded page of the picker catalog: the first `itemLimit` items, the matches of a search, or one item. */
export async function loadInventoryPickerOptions(
  admin: AdminClient,
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

  const itemRows = itemsResult.data ?? [];
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

type InventoryItemSupplierRow = Database['public']['Tables']['inventory_item_suppliers']['Row'];

const priceRowSchema = z.object({
  id: uuidSchema,
  item_id: uuidSchema,
  kind: z.enum(ARTICLE_PRICE_KINDS),
  amount_cents: z.number().int(),
  price_quantity: z.literal(PRICE_QUANTITIES),
  valid_from: z.iso.date(),
  source: z.enum(ARTICLE_PRICE_ORIGINS),
  created_at: z.string(),
});
const currentPriceRowSchema = z.object({
  item_id: uuidSchema,
  purchase_price_id: uuidSchema.nullable(),
  sale_price_id: uuidSchema.nullable(),
});

/** The references, every price and today's price ids of the listed articles, started together. */
function readArticleTermRows(admin: AdminClient, orgId: string, itemIds: string[], priceDate: string) {
  return Promise.all([
    readInBatches(itemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_suppliers')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('created_at')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(itemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_prices')
            .select('id, item_id, kind, amount_cents, price_quantity, valid_from, source, created_at')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('valid_from', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(itemIds, (batch) =>
      admin.rpc('inventory_item_prices_on_day', {
        p_organization_id: orgId,
        p_item_ids: [...batch],
        p_on_date: priceDate,
      }),
    ),
  ]);
}

/** Each article's references and prices, the prices that apply today marked. */
function toArticleTermsByItem(
  references: InventoryItemSupplierRow[],
  prices: z.infer<typeof priceRowSchema>[],
  current: z.infer<typeof currentPriceRowSchema>[],
): Record<string, ArticleTerms> {
  const currentIds = new Set(
    current.flatMap((row) => [row.purchase_price_id, row.sale_price_id].filter((id) => id !== null)),
  );
  const byItem: Record<string, ArticleTerms> = {};
  const termsOf = (itemId: string): ArticleTerms => (byItem[itemId] ??= { suppliers: [], prices: [] });
  for (const reference of references) {
    termsOf(reference.item_id).suppliers.push({
      id: reference.id,
      supplierId: reference.supplier_id,
      supplierArticleNumber: reference.supplier_article_number,
      purchaseUnit: reference.purchase_unit,
      packQuantity: toNumber(reference.pack_quantity),
      baseQuantity: toNumber(reference.base_quantity),
      isPreferred: reference.is_preferred,
    });
  }
  for (const price of prices) {
    termsOf(price.item_id).prices.push({
      id: price.id,
      kind: price.kind,
      amountCents: price.amount_cents,
      priceQuantity: price.price_quantity,
      validFrom: price.valid_from,
      origin: price.source,
      recordedAt: price.created_at,
      isCurrent: currentIds.has(price.id),
    });
  }
  return byItem;
}

/**
 * The supplier references and every price of the listed articles, with the
 * prices that apply today (Berlin) marked by `inventory_item_prices_on_day`.
 * A failed or malformed read is `failed`, never an article without terms.
 */
export async function loadArticleTermsPage(
  admin: AdminClient,
  orgId: string,
  itemIds: string[],
): Promise<ArticleTermsPage> {
  const priceDate = getBusinessTodayIso();
  const [referencesResult, pricesResult, currentResult] = await readArticleTermRows(
    admin,
    orgId,
    itemIds,
    priceDate,
  );
  const prices = z.array(priceRowSchema).safeParse(pricesResult.data);
  const current = z.array(currentPriceRowSchema).safeParse(currentResult.data);
  if (
    referencesResult.error ||
    pricesResult.error ||
    currentResult.error ||
    !prices.success ||
    !current.success
  ) {
    logReadErrors(
      'loadArticleTermsPage: read failed',
      referencesResult.error,
      pricesResult.error,
      currentResult.error ?? (current.success && prices.success ? null : { code: 'malformed_result' }),
    );
    return { status: 'failed' };
  }
  return {
    status: 'loaded',
    priceDate,
    byItem: toArticleTermsByItem(referencesResult.data, prices.data, current.data),
  };
}
