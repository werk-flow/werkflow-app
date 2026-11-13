import type { OrgRole } from '@/lib/roles';
import { MANAGED_ROLES } from '@/lib/time-tracking/types';

/**
 * Whether the viewer sees a member's clock status: `hidden` when their role may
 * not, `not_loaded` when the status read failed before any status arrived.
 */
export type StatusVisibility = 'visible' | 'hidden' | 'not_loaded';

/** Why a member's status is hidden; the badge and the hours display show it on hover. */
export const HIDDEN_STATUS_HINT = 'Den Arbeitsstatus von Büro und Admin sehen nur Admins.';

type StatusViewer = { userId: string; role: OrgRole };
type StatusMember = { userId: string; role: OrgRole; hasStatus: boolean };

/**
 * Admin sees everyone; Büro sees itself and the roles in MANAGED_ROLES. A
 * member the viewer may see but whose status never arrived is not loaded.
 */
export function memberStatusVisibility(
  viewer: StatusViewer,
  member: StatusMember,
  statusReadFailed: boolean,
): StatusVisibility {
  const mayView =
    viewer.role === 'admin' ||
    viewer.userId === member.userId ||
    (viewer.role === 'buero' && MANAGED_ROLES.includes(member.role));
  if (!mayView) return 'hidden';
  return statusReadFailed && !member.hasStatus ? 'not_loaded' : 'visible';
}
