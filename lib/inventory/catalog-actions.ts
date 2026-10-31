'use server';

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { upsertInventoryItemSchema } from './action-schemas';
import { loadActiveInventoryLocations, loadInventoryOverviewLists } from './catalog-reads';
import { inventoryPageQuerySchema, inventoryPageResultSchema } from './list-page';
import type { UpsertInventoryItemInput } from './action-inputs';
import type { InventoryItem, InventoryLocation, InventoryOverview } from './types';
import { toInventoryItem } from './types';
import {
  cleanText,
  ensureInventoryDefaults,
  invalidateInventory,
  inventoryWriteFailure,
  normalizeInventoryUnitInput,
  normalizePrice,
  normalizeQuantity,
} from './write-support';

// The office's catalog Server Actions: the inventory page, the storage
// locations of the work-template editor, and an item's save. Each one is for
// managers only.

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
  const [pageResult, movementsResult] = await Promise.all([
    admin.rpc('list_inventory_page', { p_organization_id: orgId, p_query: query }),
    admin
      .from('inventory_movements')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(40),
  ]);
  if (pageResult.error || movementsResult.error) {
    logReadErrors('getInventoryOverview: read failed', pageResult.error, movementsResult.error);
    return { success: false, error: 'inventory_failed' };
  }
  const parsedPage = inventoryPageResultSchema.safeParse(pageResult.data);
  if (!parsedPage.success) return { success: false, error: 'inventory_failed' };
  const page = parsedPage.data;
  const movements = movementsResult.data ?? [];
  const lists = await loadInventoryOverviewLists(admin, orgId, page, movements);
  if (!lists.success) return lists;

  const summary = page.summary;

  return {
    success: true,
    overview: {
      categories: lists.categories,
      locations: lists.locations,
      suppliers: lists.suppliers,
      items: lists.items,
      movements: lists.movements,
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
  if (!input.unit.trim()) return { success: false, error: 'unit_required' };

  const initialQuantity = normalizeQuantity(input.initialQuantity ?? 0);
  const requestedInitialLocationId = input.id ? null : (input.initialLocationId ?? null);
  if (initialQuantity > 0 && !requestedInitialLocationId) {
    return { success: false, error: 'location_required_for_initial_stock' };
  }

  const admin = createSupabaseAdminClient();
  const item = {
    item_type: input.itemType,
    name,
    description: cleanText(input.description),
    category_id: cleanText(input.categoryId),
    unit: normalizeInventoryUnitInput(input.unit),
    internal_sku: cleanText(input.internalSku),
    manufacturer: cleanText(input.manufacturer),
    supplier_id: cleanText(input.supplierId),
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
      p_supplier_name: cleanText(input.supplierName),
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
