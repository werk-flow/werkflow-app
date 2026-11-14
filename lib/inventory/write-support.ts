import 'server-only';

import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import type { AuthContext } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { IMPORT_REJECTIONS, type ImportRowOutcome } from './csv-import';
import type { previewInventoryImportSchema } from './action-schemas';
import { toNumber } from './types';
import { normalizeInventoryUnitInput } from './units';

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
  'unit_has_pack_sizes',
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

type ImportRow = z.infer<typeof previewInventoryImportSchema>['rows'][number];

/**
 * The staged form of each CSV row that preview_inventory_import keeps on its
 * batch: the row's values for the import rule, or the reason the action
 * already refuses it. The order stays the file's order.
 */
export function stagedImportRows(rows: readonly ImportRow[]): Json[] {
  return rows.map((row) => {
    const name = cleanText(row.name);
    if (!name) return { rejection: 'missing_name' };
    // An empty unit or text that names no unit of the list is refused, never read as Stück.
    const unit = normalizeInventoryUnitInput(row.unit);
    if (!unit) return { rejection: 'unknown_unit' };
    return {
      item: {
        item_type: row.itemType ?? 'material',
        name,
        unit,
        internal_sku: cleanText(row.internalSku),
        manufacturer: cleanText(row.manufacturer),
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
      },
      category_name: cleanText(row.categoryName),
      supplier_name: cleanText(row.supplierName),
      location_name: cleanText(row.locationName),
      barcode: cleanText(row.barcode),
      quantity: normalizeQuantity(row.quantity ?? 0),
    };
  });
}

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const nullableNumber = z
  .number()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

// A reason a newer release names reads as `failed`. `code` is the SQLSTATE of
// a row that failed for a reason the import does not name; it stays on the
// server for the log and never reaches the browser.
const importRowOutcomeSchema = z
  .object({
    index: z.number(),
    outcome: z.enum(['booked', 'imported', 'missing_location', 'rejected']),
    matched_by: z.enum(['internal_sku', 'barcode']).nullable().optional(),
    item_name: nullableText,
    unit: nullableText,
    location_name: nullableText,
    location_created: z.boolean().optional(),
    quantity: nullableNumber,
    quantity_after: nullableNumber,
    reason: z.enum(IMPORT_REJECTIONS).catch('failed').optional(),
    item_unit: nullableText,
    code: z
      .string()
      .regex(/^[0-9A-Z]{5}$/)
      .catch('XXXXX')
      .optional(),
  })
  .transform((row): { outcome: ImportRowOutcome; code: string | null } => ({
    outcome: {
      index: row.index,
      outcome: row.outcome,
      matchedBy: row.matched_by ?? null,
      itemName: row.item_name,
      unit: row.unit,
      locationName: row.location_name,
      locationCreated: row.location_created ?? false,
      quantity: row.quantity ?? 0,
      quantityAfter: row.quantity_after,
      reason: row.outcome === 'rejected' ? (row.reason ?? 'failed') : null,
      itemUnit: row.item_unit,
    },
    code: row.outcome === 'rejected' ? (row.code ?? null) : null,
  }));

/**
 * The answer of preview_inventory_import and book_inventory_import: the rows
 * for the browser, and how many rows failed with each unnamed SQLSTATE.
 */
export const importAnswerSchema = z
  .object({
    batch_id: z.string().optional(),
    already_booked: z.boolean().optional(),
    rows: z.array(importRowOutcomeSchema),
  })
  .transform((answer) => {
    const failureCodes = new Map<string, number>();
    for (const { code } of answer.rows) {
      if (code !== null) failureCodes.set(code, (failureCodes.get(code) ?? 0) + 1);
    }
    return {
      batchId: answer.batch_id ?? null,
      alreadyBooked: answer.already_booked ?? false,
      rows: answer.rows.map((row) => row.outcome),
      failureCodes,
    };
  });

/**
 * Logs each SQLSTATE that failed rows of one preview or booking carry, once,
 * with the number of rows as its name. No cell value and no message reaches
 * the log; the codes reach neither the browser nor the report.
 */
export function logUnexpectedRowFailures(label: string, failureCodes: ReadonlyMap<string, number>): void {
  for (const [code, rows] of failureCodes) logError(label, { name: `rows:${rows}`, code });
}
