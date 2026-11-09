'use client';

import { useCallback } from 'react';
import { usePlanningWarningConfirmation } from '@/components/kalender/planning-warning-dialog';
import { saveUntilPlanningSettled, type RetryWithPlanningApproval } from './planning-warning-result';

/**
 * A job save that plans a visit: while the server reports planning conflicts,
 * the manager confirms them with a reason for that exact assessment in the
 * calendar's warning dialog and the save runs again.
 */
export function usePlanningApprovalRetry(): {
  retryWithPlanningApproval: RetryWithPlanningApproval;
  planningWarningDialog: React.ReactNode;
} {
  const { requestApproval, warningDialog } = usePlanningWarningConfirmation();
  const retryWithPlanningApproval: RetryWithPlanningApproval = useCallback(
    (save) => saveUntilPlanningSettled(save, requestApproval),
    [requestApproval],
  );
  return { retryWithPlanningApproval, planningWarningDialog: warningDialog };
}
