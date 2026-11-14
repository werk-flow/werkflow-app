import { addLocalDays, getLocalWeekday, resolveBerlinWallTime } from '@/lib/date-time/berlin';

// The one home of the Bereitschaft time rules (werk-flow/werkflow-planning#469).
// A shift is an interval of instants, so midnight, a weekend and a DST change
// need no special case: it is on call from its start until, not including,
// its end. A cancelled shift never is.

type ShiftTime = { startsAt: string; endsAt: string; cancelledAt: string | null };

export type ShiftPhase = 'planned' | 'running' | 'over' | 'cancelled';

export function shiftPhase(shift: ShiftTime, at: Date): ShiftPhase {
  if (shift.cancelledAt !== null) return 'cancelled';
  const now = at.getTime();
  if (now < Date.parse(shift.startsAt)) return 'planned';
  return now < Date.parse(shift.endsAt) ? 'running' : 'over';
}

export function isOnCallAt(shift: ShiftTime, at: Date): boolean {
  return shiftPhase(shift, at) === 'running';
}

/**
 * The start a save sends. A running shift keeps its stored instant: the form
 * shows minutes, while a handover starts the next shift at the exact second.
 */
export function startToSave(storedStart: string | null, typedStart: Date, at: Date): string {
  return storedStart !== null && Date.parse(storedStart) <= at.getTime()
    ? storedStart
    : typedStart.toISOString();
}

/** The Berlin week (Monday to Monday) a calendar day falls in, as the instants a list reads. */
export function onCallWeek(localDate: string): { monday: string; from: Date; until: Date } {
  const monday = addLocalDays(localDate, -getLocalWeekday(localDate));
  const from = resolveBerlinWallTime(`${monday}T00:00`);
  const until = resolveBerlinWallTime(`${addLocalDays(monday, 7)}T00:00`);
  // Berlin midnight always exists; the check only satisfies the type.
  if (!from || !until) throw new Error('invalid_berlin_midnight');
  return { monday, from: from.instant, until: until.instant };
}
