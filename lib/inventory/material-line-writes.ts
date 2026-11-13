import 'server-only';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AuthContext } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { z } from '@/lib/zod';
import type { updateJobMaterialLineSchema } from './action-schemas';
import type { JobMaterialLineRow } from './types';
import { toInventoryItem, toNumber } from './types';
import { cleanText, invalidateInventory, normalizeQuantity, resolveInventoryLocation } from './write-support';

// The planned material line writes behind the job and project Server Actions
// in `./actions`. The callers authorize the caller and the job or project
// first.

// plan_job_material raises these refusals; the action passes them on.
const PLAN_REFUSALS = new Set([
  'not_authorized',
  'quantity_required',
  'job_not_found',
  'project_not_found',
  'item_not_found',
  'location_not_found',
]);

/**
 * Plans an article on a job or a project whose access the calling action has
 * already checked, through plan_job_material: one call checks the article and
 * the Lager inside the caller's organization and inserts the line. A database
 * function that plans material inside its own transaction calls
 * plan_job_material directly.
 */
export async function planMaterialLine(
  admin: AdminClient,
  context: AuthContext,
  {
    target,
    input,
    failureLabel,
  }: {
    target: { jobId: string; projectId: null } | { jobId: null; projectId: string };
    input: {
      itemId: string;
      preferredLocationId?: string | null | undefined;
      plannedQuantity: number;
      notes?: string | null | undefined;
    };
    failureLabel: string;
  },
): Promise<ActionResult<{ lineId: string }>> {
  const plannedQuantity = normalizeQuantity(input.plannedQuantity);
  if (plannedQuantity <= 0) return { success: false, error: 'quantity_required' };

  const { data, error } = await admin.rpc(
    'plan_job_material',
    rpcArgs('plan_job_material', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_job_id: target.jobId,
      p_project_id: target.projectId,
      p_item_id: input.itemId,
      p_planned_quantity: plannedQuantity,
      p_preferred_location_id: cleanText(input.preferredLocationId),
      p_notes: cleanText(input.notes),
      p_source_kind: null,
      p_source_id: null,
    }),
  );

  if (error || !data) {
    const message = error?.message ?? '';
    if (PLAN_REFUSALS.has(message)) return { success: false, error: message };
    logError(failureLabel, error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');

  // The write already committed. Refreshing labels/stock belongs to the reader;
  // a failed read must never tell the caller to repeat this mutation.
  return { success: true, lineId: data };
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
