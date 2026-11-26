import { addLocalDays } from '@/lib/date-time/berlin';
import type { MaintenanceDueStatus } from './types';

/**
 * A due item is überfällig while it is still owed (open, or with a visit job
 * but no recorded outcome) and its due date lies before `today`, the Berlin
 * calendar day. Dates are ISO `YYYY-MM-DD`, so they compare as strings.
 * `read_maintenance_workspace_page` applies the same rule in the database.
 */
export function isMaintenanceDueOverdue(
  due: { dueDate: string; status: MaintenanceDueStatus },
  today: string,
): boolean {
  return (due.status === 'open' || due.status === 'visit_created') && due.dueDate < today;
}

/** How many Berlin days ahead of its due date an open due item reaches Aufgaben. */
export const MAINTENANCE_DUE_LEAD_DAYS = 14;

/**
 * An open due item, one without a visit job, belongs in Aufgaben while it is
 * überfällig or due within the lead time: on `today` or up to
 * MAINTENANCE_DUE_LEAD_DAYS Berlin days after it. A visit job, an exception or
 * a completion takes it out. `read_manager_attention_sets` returns these
 * items with the same window.
 */
export function isMaintenanceDueForAufgaben(
  due: { dueDate: string; status: MaintenanceDueStatus },
  today: string,
): boolean {
  return due.status === 'open' && due.dueDate <= addLocalDays(today, MAINTENANCE_DUE_LEAD_DAYS);
}
