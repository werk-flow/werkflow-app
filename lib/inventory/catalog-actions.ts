'use server';

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import {
  addArticlePriceSchema,
  removeArticleSupplierSchema,
  saveArticleSupplierSchema,
  upsertInventoryItemSchema,
  type AddArticlePriceInput,
  type RemoveArticleSupplierInput,
  type SaveArticleSupplierInput,
} from './action-schemas';
import {
  loadActiveInventoryLocations,
  loadArticleTermsPage,
  loadInventoryMovementPage,
  loadInventoryOverviewLists,
} from './catalog-reads';
import { inventoryPageQuerySchema, inventoryPageResultSchema } from './list-page';
import type { UpsertInventoryItemInput } from './action-inputs';
import type { InventoryItem, InventoryLocation, InventoryMovementPage, InventoryOverview } from './types';
import { toInventoryItem } from './types';
import { normalizeInventoryUnitInput } from './units';
import {
  cleanText,
  ensureInventoryDefaults,
  invalidateInventory,
  inventoryWriteFailure,
  normalizePrice,
  normalizeQuantity,
} from './write-support';

// The office's catalog Server Actions: the inventory page, its movement
// history, the storage locations of the work-template editor, an item's save,
// and its supplier references and dated prices. Each one is for managers only.

// The refusals of save_inventory_item_supplier, remove_inventory_item_supplier
// and add_inventory_item_price (migration 20261203090000).
const articleTermsRefusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invalid_input',
    'item_not_found',
    'supplier_not_found',
    'supplier_required',
    'supplier_reference_not_found',
    'supplier_reference_taken',
    'unit_changed',
  ]),
);

export async function getInventoryOverview(
  input: unknown = {},
): Promise<ActionResult<{ overview: InventoryOverview }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const parsedQuery = inventoryPageQuerySchema.safeParse(input);
  if (!parsedQuery.success) return { success: false, error: 'inventory_failed' };
  const query = parsedQuery.data;
  const admin = createSupabaseAdminClient();
  const { orgId } = auth.context;
  await ensureInventoryDefaults(admin, auth.context);
  const pageResult = await admin.rpc('list_inventory_page', { p_organization_id: orgId, p_query: query });
  if (pageResult.error) {
    logReadErrors('getInventoryOverview: read failed', pageResult.error);
    return { success: false, error: 'inventory_failed' };
  }
  const parsedPage = inventoryPageResultSchema.safeParse(pageResult.data);
  if (!parsedPage.success) return { success: false, error: 'inventory_failed' };
  const page = parsedPage.data;
  const [lists, articleTerms] = await Promise.all([
    loadInventoryOverviewLists(admin, orgId, page),
    loadArticleTermsPage(admin, orgId, page.ids),
  ]);
  if (!lists.success) return lists;

  const summary = page.summary;

  return {
    success: true,
    overview: {
      categories: lists.categories,
      locations: lists.locations,
      suppliers: lists.suppliers,
      items: lists.items,
      articleTerms,
      summary,
      page: {
        query,
        ids: page.ids,
        total: page.total,
        locationIds: page.locationIds,
        locationCounts: page.locationCounts,
      },
    },
  };
}

/**
 * One page of the movement history of `/inventar` for the URL state `input`.
 * A Lager filter must name a Lager of the caller's organization.
 */
export async function getInventoryMovementHistory(
  input: unknown = {},
): Promise<ActionResult<{ history: InventoryMovementPage }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const parsedQuery = inventoryPageQuerySchema.safeParse(input);
  if (!parsedQuery.success) return { success: false, error: 'invalid_input' };
  const query = parsedQuery.data;
  const admin = createSupabaseAdminClient();
  const { orgId } = auth.context;
  if (query.location !== 'all') {
    const { data, error } = await admin
      .from('inventory_locations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('id', query.location)
      .maybeSingle();
    if (error) {
      logReadErrors('getInventoryMovementHistory: location read failed', error);
      return { success: true, history: { status: 'failed' } };
    }
    if (!data) return { success: false, error: 'location_not_found' };
  }
  return { success: true, history: await loadInventoryMovementPage(admin, orgId, query) };
}

/**
 * The active storage locations for the work-template editor. A company holds
 * a handful of locations, so they come complete; the material picker searches
 * the catalog on the server (`'entity-options'`, kind `inventory-items`).
 */
export async function getInventoryLocationOptions(): Promise<
  ActionResult<{ locations: InventoryLocation[] }>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  await ensureInventoryDefaults(admin, auth.context);
  return loadActiveInventoryLocations(admin, auth.context.orgId);
}

export async function upsertInventoryItem(
  rawInput: UpsertInventoryItemInput,
): Promise<ActionResult<{ item: InventoryItem }>> {
  const parsedInput = upsertInventoryItemSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const name = cleanText(input.name);
  if (!name) return { success: false, error: 'name_required' };
  const unit = normalizeInventoryUnitInput(input.unit);
  if (!unit) return { success: false, error: input.unit.trim() ? 'unit_unknown' : 'unit_required' };

  const initialQuantity = normalizeQuantity(input.initialQuantity ?? 0);
  const requestedInitialLocationId = input.id ? null : (input.initialLocationId ?? null);
  if (initialQuantity > 0 && !requestedInitialLocationId) {
    return { success: false, error: 'location_required_for_initial_stock' };
  }

  const admin = createSupabaseAdminClient();
  // A new article starts with its supplier and prices; an existing one changes
  // them in the dialog's „Lieferanten“ and „Preise“, so its save leaves them out.
  const supplierAndPrices = input.id
    ? {}
    : {
        supplier_id: cleanText(input.supplierId),
        supplier_article_number: cleanText(input.supplierArticleNumber),
        purchase_price_cents: normalizePrice(input.purchasePriceCents),
        sale_price_cents: normalizePrice(input.salePriceCents),
      };
  const item = {
    item_type: input.itemType,
    name,
    description: cleanText(input.description),
    category_id: cleanText(input.categoryId),
    unit,
    internal_sku: cleanText(input.internalSku),
    manufacturer: cleanText(input.manufacturer),
    ...supplierAndPrices,
    is_billable: input.isBillable,
    global_minimum_stock: normalizeQuantity(input.globalMinimumStock ?? 0),
    global_target_stock:
      input.globalTargetStock === null || input.globalTargetStock === undefined
        ? null
        : normalizeQuantity(input.globalTargetStock),
    track_quantity: input.trackQuantity ?? true,
    track_individual_assets: input.trackIndividualAssets ?? ['asset', 'tool'].includes(input.itemType),
    notes: cleanText(input.notes),
  };

  // The item, its primary barcode and its first count commit together or not at all.
  const { data, error } = await admin.rpc(
    'save_inventory_item',
    rpcArgs('save_inventory_item', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_item_id: input.id ?? null,
      p_item: item,
      p_supplier_name: input.id ? null : cleanText(input.supplierName),
      p_barcode: cleanText(input.barcode),
      p_initial_location_id: requestedInitialLocationId,
      p_initial_quantity: input.id ? 0 : initialQuantity,
    }),
  );
  if (error) {
    return inventoryWriteFailure('upsertInventoryItem: save_inventory_item failed', error, 'save_failed');
  }

  invalidateInventory();
  return { success: true, item: toInventoryItem(data) };
}

/** Rounds a conversion quantity to the thousandths `numeric(12,3)` keeps. */
function conversionQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Creates or changes one supplier reference of an article: the supplier, its
 * article number and the purchase unit with its conversion to the base unit.
 * A preferred reference becomes the article's supplier.
 */
export async function saveArticleSupplier(
  rawInput: SaveArticleSupplierInput,
): Promise<ActionResult<{ referenceId: string }>> {
  const parsedInput = saveArticleSupplierSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const supplierName = cleanText(input.supplierName);
  if (!input.supplierId && !supplierName) return { success: false, error: 'supplier_required' };
  const packQuantity = input.purchaseUnit ? conversionQuantity(input.packQuantity) : 1;
  const baseQuantity = input.purchaseUnit ? conversionQuantity(input.baseQuantity) : 1;
  if (packQuantity <= 0 || baseQuantity <= 0) return { success: false, error: 'invalid_conversion' };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    'save_inventory_item_supplier',
    rpcArgs('save_inventory_item_supplier', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_item_id: input.itemId,
      p_unit: input.unit,
      p_reference_id: input.referenceId,
      p_supplier_id: input.supplierId,
      p_supplier_name: input.supplierId ? null : supplierName,
      p_supplier_article_number: cleanText(input.supplierArticleNumber),
      p_purchase_unit: input.purchaseUnit,
      p_pack_quantity: packQuantity,
      p_base_quantity: baseQuantity,
      p_is_preferred: input.isPreferred,
    }),
  );
  if (error || !data) {
    return articleTermsRefusal(
      error,
      'save_failed',
      'saveArticleSupplier: save_inventory_item_supplier failed',
    );
  }
  invalidateInventory();
  return { success: true, referenceId: data };
}

/** Removes one supplier reference; the oldest remaining one becomes preferred when needed. */
export async function removeArticleSupplier(rawInput: RemoveArticleSupplierInput): Promise<ActionResult> {
  const parsedInput = removeArticleSupplierSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('remove_inventory_item_supplier', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_reference_id: parsedInput.data.referenceId,
  });
  if (error) {
    return articleTermsRefusal(
      error,
      'save_failed',
      'removeArticleSupplier: remove_inventory_item_supplier failed',
    );
  }
  invalidateInventory();
  return { success: true };
}

/** Records a purchase or sale price of an article from its first day on; earlier prices stay. */
export async function addArticlePrice(
  rawInput: AddArticlePriceInput,
): Promise<ActionResult<{ priceId: string }>> {
  const parsedInput = addArticlePriceSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('add_inventory_item_price', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_item_id: input.itemId,
    p_unit: input.unit,
    p_kind: input.kind,
    p_amount_cents: input.amountCents,
    p_price_quantity: input.priceQuantity,
    p_valid_from: input.validFrom,
  });
  if (error || !data) {
    return articleTermsRefusal(error, 'save_failed', 'addArticlePrice: add_inventory_item_price failed');
  }
  invalidateInventory();
  return { success: true, priceId: data };
}
