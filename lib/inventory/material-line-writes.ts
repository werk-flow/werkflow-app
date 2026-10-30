import 'server-only';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AuthContext } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { z } from '@/lib/zod';
import type { updateJobMaterialLineSchema } from './action-schemas';
import type { JobMaterialLineRow } from './types';
import { toInventoryItem, toNumber } from './types';
import { cleanText, invalidateInventory, normalizeQuantity, resolveInventoryLocation } from './write-support';

// The planned material line writes behind the job and project Server Actions
// in `./actions`. The callers authorize the caller and the job or project
// first.

// The shared write of a planned material line for a job or a project whose
// access the calling action has already checked.
export async function insertMaterialLine(
  admin: AdminClient,
  context: AuthContext,
  {
    owner,
    input,
    readLabel,
    failureLabel,
  }: {
    owner: { job_id: string | null; project_id: string | null };
    input: {
      itemId: string;
      preferredLocationId?: string | null | undefined;
      plannedQuantity: number;
      notes?: string | null | undefined;
    };
    readLabel: string;
    failureLabel: string;
  },
): Promise<ActionResult<{ lineId: string }>> {
  const plannedQuantity = normalizeQuantity(input.plannedQuantity);
  if (plannedQuantity <= 0) return { success: false, error: 'quantity_required' };

  const { data: itemRow, error: itemRowError } = await loggedRead(
    readLabel,
    admin
      .from('inventory_items')
      .select('*')
      .eq('id', input.itemId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (itemRowError) return { success: false, error: 'load_failed' };

  const item = itemRow ? toInventoryItem(itemRow) : null;
  if (!item) return { success: false, error: 'item_not_found' };

  const locationReference = await resolveInventoryLocation(admin, context.orgId, input.preferredLocationId);
  if (!locationReference.success) return locationReference;

  const { data, error } = await admin
    .from('job_material_lines')
    .insert({
      organization_id: context.orgId,
      ...owner,
      item_id: item.id,
      preferred_location_id: locationReference.referenceId,
      planned_quantity: plannedQuantity,
      is_billable: item.isBillable,
      notes: cleanText(input.notes),
      created_by: context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    logError(failureLabel, error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');

  // The write already committed. Refreshing labels/stock belongs to the reader;
  // a failed read must never tell the caller to repeat this mutation.
  return { success: true, lineId: data.id };
}

/**
 * The columns an update of the existing line changes. A new item is refused
 * once the line has movements and takes the item's billability; a preferred
 * location must belong to the caller's organization.
 */
export async function materialLineChanges(
  admin: AdminClient,
  orgId: string,
  existing: JobMaterialLineRow,
  input: z.infer<typeof updateJobMaterialLineSchema>,
): Promise<ActionResult<{ updateData: Record<string, unknown> }>> {
  const updateData: Record<string, unknown> = {};
  if (input.itemId !== undefined && input.itemId !== existing.item_id) {
    const existingLine = existing;
    const hasMovement =
      toNumber(existingLine.taken_quantity) > 0 || toNumber(existingLine.returned_quantity) > 0;

    if (hasMovement) {
      return { success: false, error: 'line_has_movements' };
    }

    const { data: itemRow, error: itemRowError } = await loggedRead(
      'updateJobMaterialLine: inventory_items read failed',
      admin
        .from('inventory_items')
        .select('*')
        .eq('id', input.itemId)
        .eq('organization_id', orgId)
        .maybeSingle(),
    );
    if (itemRowError) return { success: false, error: 'load_failed' };

    const item = itemRow ? toInventoryItem(itemRow) : null;
    if (!item) return { success: false, error: 'item_not_found' };

    updateData.item_id = item.id;
    updateData.is_billable = item.isBillable;
  }
  if (input.preferredLocationId !== undefined) {
    const locationReference = await resolveInventoryLocation(admin, orgId, input.preferredLocationId);
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
  return { success: true, updateData };
}
