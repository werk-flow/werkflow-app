import type { CalendarBoardDay } from './board';
import type { OrgRole } from '@/lib/members/actions';
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
export function isBlockInClosedPeriod(
  block: Pick<CalendarWorkBlock, 'sourceEntries'>,
  closedPeriods: readonly ClosedTimePeriod[],
): boolean {
  return block.sourceEntries.some((entry) => isEntryInClosedPeriod(entry, closedPeriods));
}

/**
 * Who may move or resize a recorded block: admins everything, Büro their own
 * and employees' blocks, employees nothing; nobody a block of a closed period.
 */
export function canManageBlock(
  block: CalendarWorkBlock,
  currentUserRole: OrgRole,
  currentUserId: string,
  entryUserRole: string | undefined,
  closedPeriods: readonly ClosedTimePeriod[],
): boolean {
  if (block.sourceEntries.some((entry) => entry.status === 'pending_delete')) return false;
  if (isBlockInClosedPeriod(block, closedPeriods)) return false;
  if (currentUserRole === 'admin') return true;
  if (currentUserRole === 'buero') return entryUserRole === 'employee' || block.userId === currentUserId;
  return false;
}
