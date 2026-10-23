import type { CalendarBoardDay } from './board';
import { isManagerRole, isOrgRole, type OrgRole } from '@/lib/roles';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { canApproveEntries } from '@/lib/time-tracking/helpers';
import type { CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import { isEntryInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';

/**
 * A person's day in the day view: why it is not an ordinary working day, and
 * who may change the recorded time on it.
 */

/** The short note beside a person's name: absence first, then holiday or closure, then a day off. */
export function dayRowLabel(boardDay: CalendarBoardDay | undefined): string | null {
  if (!boardDay) return null;
  if (boardDay.absence)
    return boardDay.absence.type === 'vacation'
      ? boardDay.absence.portion === 'half_day'
        ? 'Urlaub (halber Tag)'
        : 'Urlaub'
      : 'Krank';
  if (boardDay.reason === 'holiday' || boardDay.reason === 'closure')
    return boardDay.label ?? (boardDay.reason === 'holiday' ? 'Feiertag' : 'Betriebsruhe');
  if (boardDay.reason === 'no_work_day' || boardDay.targetMinutes === 0) return 'Kein Arbeitstag';
  return null;
}

/** True when the timeline draws the day as off: a full absence, a non-working reason or no target. */
export function isDayRowOff(boardDay: CalendarBoardDay | undefined): boolean {
  return Boolean(
    boardDay &&
      (boardDay.absence?.portion === 'full' || boardDay.reason !== 'working' || boardDay.targetMinutes === 0),
  );
}

/** True when one of the block's entries lies in a closed period, so the server refuses every change to it. */
function isBlockInClosedPeriod(
  block: Pick<CalendarWorkBlock, 'sourceEntries'>,
  closedPeriods: readonly ClosedTimePeriod[],
): boolean {
  return block.sourceEntries.some((entry) => isEntryInClosedPeriod(entry, closedPeriods));
}

/**
 * Who may move or resize a recorded block, as `submitTimeCorrection` decides it:
 * a manager their own block, and another person's block only through the
 * caller's `time_approval` holder (`canApproveEntries`); employees correct
 * their time under Zeiterfassung; nobody a block of a closed period or with a
 * pending deletion.
 */
export function canManageBlock(
  block: CalendarWorkBlock,
  entryUserRole: string | null | undefined,
  viewer: {
    currentUserRole: OrgRole;
    currentUserId: string;
    approvalHolder: EffectiveResponsibilityHolder | null;
    closedPeriods: readonly ClosedTimePeriod[];
  },
): boolean {
  const { currentUserRole, currentUserId, approvalHolder, closedPeriods } = viewer;
  if (block.sourceEntries.some((entry) => entry.status === 'pending_delete')) return false;
  if (isBlockInClosedPeriod(block, closedPeriods)) return false;
  if (!isManagerRole(currentUserRole)) return false;
  if (block.userId === currentUserId) return true;
  if (!entryUserRole || !isOrgRole(entryUserRole)) return false;
  return canApproveEntries(approvalHolder, block.userId, entryUserRole);
}
