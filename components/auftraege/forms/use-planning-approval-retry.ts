'use client';

import { useCallback } from 'react';
import type { ActionFailure } from '@/lib/action-result';
import { usePlanningWarningConfirmation } from '@/components/kalender/planning-warning-dialog';
import type {
  PlanningConflictApproval,
  PlanningWarningFailure,
} from '@/lib/planning/conflict-acknowledgement';

type SaveResult = { success: true } | ActionFailure;

/** The visit, its people or their plans changed after the server assessed the save. */
export const PLANNING_CHANGED_MESSAGE =
  'Die Planung hat sich inzwischen geändert. Prüfe die Angaben und speichere erneut.';

/** A save the server refused for the planning conflicts of the visit it plans. */
export function isPlanningWarning(result: SaveResult): result is PlanningWarningFailure {
  return !result.success && (result.error === 'planning_warning' || result.error === 'stale_assessment');
}

/**
 * A job save that plans a visit: while the server reports planning conflicts,
 * the manager confirms them with a reason for that exact assessment and the
 * save runs again. A planning warning as the result means the manager took
 * the change back.
 */
export function usePlanningApprovalRetry(): {
  retryWithPlanningApproval: <Result extends SaveResult>(
    save: (planningApproval: PlanningConflictApproval | null) => Promise<Result>,
  ) => Promise<Result>;
  planningWarningDialog: React.ReactNode;
} {
  const { requestApproval, warningDialog } = usePlanningWarningConfirmation();
  const retryWithPlanningApproval = useCallback(
    async <Result extends SaveResult>(
      save: (planningApproval: PlanningConflictApproval | null) => Promise<Result>,
    ): Promise<Result> => {
      let result = await save(null);
      while (isPlanningWarning(result)) {
        const approval = await requestApproval(result.conflicts, result.fingerprint);
        if (!approval) return result;
        result = await save(approval);
      }
      return result;
    },
    [requestApproval],
  );
  return { retryWithPlanningApproval, planningWarningDialog: warningDialog };
}
