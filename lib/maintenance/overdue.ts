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
