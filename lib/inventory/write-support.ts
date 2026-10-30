import 'server-only';

import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import type { AuthContext } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { z } from '@/lib/zod';
import type { importInventoryRowsSchema } from './action-schemas';
import { toNumber } from './types';

// The value rules and write helpers the inventory Server Actions in
// `./actions` and `./catalog-actions` share. The callers authorize first and
// pass only server-resolved organization and actor ids.

export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

// Quantities are `numeric(12,3)`: rounding to two digits turned a booked
// 0,125 m into 0,13 and refused its return as more than was taken.
export function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 1000) / 1000);
}

export function normalizePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

export function normalizeInventoryUnitInput(value: string | null | undefined): string {
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

export function invalidateInventory(): void {
  revalidatePath('/inventar');
}

export async function ensureInventoryDefaults(admin: AdminClient, context: AuthContext): Promise<void> {
  const { error } = await admin.rpc('ensure_inventory_defaults', {
    p_org_id: context.orgId,
    p_actor_id: context.userId,
  });

  if (error) {
    logError('Error ensuring inventory defaults:', error);
  }
}

// The refusals of save_inventory_item, import_inventory_row (migration
// 20261004151000) and take_unplanned_inventory_material (20261004151100) that
// the action passes on as its failure code.
const INVENTORY_WRITE_REFUSALS = new Set([
  'not_authorized',
  'invalid_input',
  'location_required_for_initial_stock',
  'item_not_found',
  'category_not_found',
  'supplier_not_found',
  'location_not_found',
  'barcode_taken',
  'batch_not_found',
  'job_not_found',
  'project_not_found',
]);

export function inventoryWriteFailure(
  label: string,
  error: { code?: string; message?: string },
  fallback: 'save_failed' | 'movement_failed',
): ActionFailure {
  const message = error.message ?? '';
  if (INVENTORY_WRITE_REFUSALS.has(message)) return { success: false, error: message };
  logError(label, error);
  if (message.includes('inventory stock cannot go below zero')) {
    return { success: false, error: 'stock_would_go_negative' };
  }
  if (message.includes('not available for stock movement'))
    return { success: false, error: 'movement_failed' };
  return { success: false, error: fallback };
}

// A take without a planned line: the unplanned line and the take commit
// together, so a refused take leaves no empty line behind.
export async function takeUnplannedMaterial(
  admin: AdminClient,
  context: AuthContext,
  input: {
    jobId: string | null;
    projectId: string | null;
    itemId: string;
    locationId: string;
    quantity: number;
    reason: string | null | undefined;
    defaultReason: string;
  },
): Promise<ActionResult<{ quantityAfter: number }>> {
  const { data, error } = await admin.rpc(
    'take_unplanned_inventory_material',
    rpcArgs('take_unplanned_inventory_material', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_job_id: input.jobId,
      p_project_id: input.projectId,
      p_item_id: input.itemId,
      p_location_id: input.locationId,
      p_quantity: input.quantity,
      p_reason: cleanText(input.reason) ?? input.defaultReason,
      p_notes: cleanText(input.reason),
    }),
  );
  if (error) {
    return inventoryWriteFailure(
      'takeUnplannedMaterial: take_unplanned_inventory_material failed',
      error,
      'movement_failed',
    );
  }
  return { success: true, quantityAfter: toNumber(data) };
}

/** A location id of the caller's organization, null for none, or `location_not_found`. */
export async function resolveInventoryLocation(
  admin: AdminClient,
  organizationId: string,
  inputId: string | null | undefined,
): Promise<ActionResult<{ referenceId: string | null }>> {
  const table = 'inventory_locations';
  const referenceId = cleanText(inputId);
  if (!referenceId) return { success: true, referenceId: null };

  const { data, error } = await admin
    .from(table)
    .select('id')
    .eq('id', referenceId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    logError('Error resolving inventory organization reference.', {
      code: error.code ?? 'unknown',
      table,
    });
    return { success: false, error: 'reference_lookup_failed' };
  }

  const resolvedReference = data;
  if (!resolvedReference) return { success: false, error: 'location_not_found' };

  return { success: true, referenceId: resolvedReference.id };
}

/** The `p_item` of one CSV row for import_inventory_row. */
export function inventoryImportItem(
  row: z.infer<typeof importInventoryRowsSchema>['rows'][number],
  name: string,
): Json {
  return {
    item_type: row.itemType ?? 'material',
    name,
    unit: normalizeInventoryUnitInput(row.unit),
    internal_sku: cleanText(row.internalSku),
    manufacturer: cleanText(row.manufacturer),
    supplier_article_number: cleanText(row.supplierArticleNumber),
    purchase_price_cents: normalizePrice(row.purchasePriceCents),
    sale_price_cents: normalizePrice(row.salePriceCents),
    is_billable: row.isBillable ?? true,
    global_minimum_stock: normalizeQuantity(row.minimumStock ?? 0),
    global_target_stock:
      row.targetStock === null || row.targetStock === undefined ? null : normalizeQuantity(row.targetStock),
    notes: cleanText(row.notes),
  };
}

/** Closes the import batch with its counts; a failed close is logged and the import still answers. */
export async function completeInventoryImportBatch(
  admin: AdminClient,
  organizationId: string,
  batchId: string,
  counts: { importedCount: number; missingLocationCount: number; failedCount: number },
): Promise<void> {
  const { error: updateError } = await admin
    .from('inventory_import_batches')
    .update({
      status: counts.failedCount > 0 ? 'failed' : 'imported',
      // The batch has no column for rows without a Lager; their items were imported.
      imported_count: counts.importedCount + counts.missingLocationCount,
      failed_count: counts.failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq('organization_id', organizationId)
    .eq('id', batchId);

  if (updateError) {
    logError('Error updating inventory import batch:', updateError);
  }
}
