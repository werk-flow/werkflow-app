// The office's „Fällige Wartungen“ tasks behind the attention Server Actions
// in `./actions`: open due maintenance without a visit job that is überfällig
// or due within the lead time. The database returns the items with the
// office's other pending sets (`./manager-sets`); the rule is
// lib/maintenance/overdue.ts, the Wartung workspace's own.

import { isMaintenanceDueForAufgaben, isMaintenanceDueOverdue } from '@/lib/maintenance/overdue';
import { maintenancePlanSearchHref } from '@/lib/maintenance/workspace-page';
import type { ActionContext } from '@/lib/org/action-context';
import { LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { ManagerAttentionSetsRead } from './manager-sets';
import type { AttentionTask } from './types';

// An open due item of the organization, with its plan, Einsatzort and Anlagen.
const dueMaintenanceRowSchema = z.object({
  id: uuidSchema,
  due_date: z.string(),
  plan_number: z.string(),
  site_name: z.string().nullable(),
  equipment_names: z.array(z.string()),
});

/** The due set of read_manager_attention_sets; it holds at most LIST_ROW_CAP + 1 rows, one more is an overflow. */
export const dueMaintenanceSetSchema = z.object({
  due_maintenance: z.array(dueMaintenanceRowSchema).max(LIST_ROW_CAP),
});

export type DueMaintenanceRow = z.infer<typeof dueMaintenanceRowSchema>;

/** The due items that belong in Aufgaben on the Berlin day `today`, in the set's order: earliest due first. */
function toMaintenanceDueTasks(rows: readonly DueMaintenanceRow[], today: string): AttentionTask[] {
  return rows
    .filter((row) => isMaintenanceDueForAufgaben({ dueDate: row.due_date, status: 'open' }, today))
    .map(
      (row): AttentionTask => ({
        sourceType: 'maintenance_due',
        sourceId: row.id,
        equipmentLabel: row.equipment_names.join(', ') || `Wartungsplan ${row.plan_number}`,
        siteName: row.site_name,
        dueDate: row.due_date,
        overdue: isMaintenanceDueOverdue({ dueDate: row.due_date, status: 'open' }, today),
        href: maintenancePlanSearchHref(row.plan_number),
      }),
    );
}

/**
 * Planning a visit or recording an exception is office work, so only Admin and
 * Büro get these tasks. `businessDate` is the Berlin day the overview reports,
 * so a read across midnight never classifies on another day than it shows.
 */
export async function deriveMaintenanceDueTasks(
  context: ActionContext,
  managerSets: ManagerAttentionSetsRead,
  businessDate: string,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const sets = await managerSets;
  if (sets.failed) return { tasks: [], failed: true };
  return { tasks: toMaintenanceDueTasks(sets.dueMaintenance, businessDate), failed: false };
}
