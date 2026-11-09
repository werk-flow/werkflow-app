import type { ActionFailure } from '@/lib/action-result';
import type {
  PlanningConflictApproval,
  PlanningWarningFailure,
} from '@/lib/planning/conflict-acknowledgement';
import type { PlanningConflict } from '@/lib/planning/types';

// The results of a job save that plans a visit, apart from the warning dialog,
// so an eager module reads them without loading the dialog.

type SaveResult = { success: true } | ActionFailure;

/** The visit, its people or their plans changed after the server assessed the save. */
export const PLANNING_CHANGED_MESSAGE =
  'Die Planung hat sich inzwischen geändert. Prüfe die Angaben und speichere erneut.';

/** A save the server refused for the planning conflicts of the visit it plans. */
export function isPlanningWarning(result: SaveResult): result is PlanningWarningFailure {
  return !result.success && (result.error === 'planning_warning' || result.error === 'stale_assessment');
}

/**
 * Runs a save; while the server reports planning conflicts, asks for the
 * reason and runs it again. A planning warning as the result means the
 * manager took the change back.
 */
export type RetryWithPlanningApproval = <Result extends SaveResult>(
  save: (planningApproval: PlanningConflictApproval | null) => Promise<Result>,
) => Promise<Result>;

/**
 * The loop behind RetryWithPlanningApproval: each planning warning asks for a
 * reason for its own assessment; no reason ends the loop with that warning.
 */
export async function saveUntilPlanningSettled<Result extends SaveResult>(
  save: (planningApproval: PlanningConflictApproval | null) => Promise<Result>,
  requestApproval: (
    conflicts: PlanningConflict[],
    fingerprint: string,
  ) => Promise<PlanningConflictApproval | null>,
): Promise<Result> {
  let result = await save(null);
  while (isPlanningWarning(result)) {
    const approval = await requestApproval(result.conflicts, result.fingerprint);
    if (!approval) return result;
    result = await save(approval);
  }
  return result;
}
