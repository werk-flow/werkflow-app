import {
  canHolderApproveTarget,
  type EffectiveResponsibilityHolder,
} from '@/lib/responsibilities/resolution';
import type { OrgRole } from '@/lib/time-tracking/types';

/**
 * Which requests of the correction history a caller sees, as the database
 * page reader `list_time_correction_history_page` applies it.
 */
export type CorrectionHistoryVisibility = 'all' | 'own' | 'own_and_employee_subjects';

// Never a member's id, so the probe asks only about the target's role.
const OTHER_MEMBER = '';

/**
 * Admin and Büro see every request. An employee sees what they filed or
 * are the subject of, plus the requests whose subject their time approval
 * reaches: every role through a direct assignment or an admin source, the
 * employee role through a Büro source (`canHolderApproveTarget`).
 */
export function correctionHistoryVisibility(
  callerRole: OrgRole,
  holder: EffectiveResponsibilityHolder | null,
): CorrectionHistoryVisibility {
  if (callerRole !== 'employee') return 'all';
  if (!holder) return 'own';
  if (canHolderApproveTarget(holder, OTHER_MEMBER, 'buero')) return 'all';
  return canHolderApproveTarget(holder, OTHER_MEMBER, 'employee') ? 'own_and_employee_subjects' : 'own';
}
