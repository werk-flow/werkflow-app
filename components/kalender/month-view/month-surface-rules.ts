import {
  checkParkedContext,
  checkOccurrenceMovable,
  checkParkable,
  checkTimeBlockTarget,
} from '@/lib/calendar/refusal-checks';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import { isDateInClosedPeriod } from '@/lib/time-tracking/closed-period-dates';
import type { CalendarDragCell, CalendarDragPayload, CalendarDragTarget } from '../drag-engine/payload';
import type { DragVerdict } from '@/lib/calendar/drag-ghost';
import type { MonthSurfaceInput } from './use-month-surface';

export function dayDelta(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** A recorded block moved to another day: it stays closed, out of closed periods and clear of other blocks. */
function monthBlockVerdict(
  { blocksByUserDate, closedPeriods, nowMs }: MonthSurfaceInput,
  target: CalendarDragCell,
  payload: Extract<CalendarDragPayload, { kind: 'timeBlock' }>,
): DragVerdict {
  const dateLabel = formatRefusalDate(target.date);
  const { session } = payload;
  if (!session.clockIn || !session.clockOut)
    return { ok: false, message: 'Offene Arbeitszeit lässt sich nicht verschieben.' };
  if (isDateInClosedPeriod(target.date, closedPeriods))
    return { ok: false, message: calendarRefusalMessage('period_closed') ?? '' };
  const delta = dayDelta(payload.sourceDate, target.date) * 86_400_000;
  const startMs = new Date(session.clockIn.timestamp).getTime() + delta;
  const endMs = new Date(session.clockOut.timestamp).getTime() + delta;
  const others = (blocksByUserDate.get(`${payload.sourceUserId}:${target.date}`) ?? []).filter(
    (block) => block.id !== session.calendarBlockId,
  );
  const check = checkTimeBlockTarget({
    startMs,
    endMs,
    nowMs: nowMs(),
    targetName: null,
    otherBlocks: others,
  });
  return check.ok ? { ok: true, label: dateLabel } : { ok: false, message: check.message };
}

/** The month's pre-check for one target: the parked context, the Parkplatz zone, and the movable and time rules. */
export function monthTargetVerdict(
  input: MonthSurfaceInput,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
): DragVerdict {
  const { nowMs, parkingContexts } = input;
  if (payload.kind === 'parked' && target.kind !== 'zone') {
    const parked = checkParkedContext(parkingContexts, payload.job);
    if (!parked.ok) return { ok: false, message: parked.message };
  }
  if (target.kind === 'zone') {
    if (payload.kind !== 'occurrence')
      return { ok: false, message: calendarRefusalMessage('only_occurrences_park') ?? '' };
    const parkable = checkParkable(payload.job);
    return parkable.ok ? { ok: true, label: 'Parken' } : { ok: false, message: parkable.message };
  }
  const dateLabel = formatRefusalDate(target.date);
  switch (payload.kind) {
    case 'occurrence': {
      const movable = checkOccurrenceMovable(payload.job, nowMs());
      return movable.ok ? { ok: true, label: dateLabel } : { ok: false, message: movable.message };
    }
    case 'parked':
      return { ok: true, label: dateLabel };
    case 'timeBlock':
      return monthBlockVerdict(input, target, payload);
    case 'untimed':
    case 'barEdge':
    case 'resizeJob':
    case 'resizeBlock':
      return { ok: false, message: 'Diese Änderung gibt es in der Tagesansicht oder auf der Plantafel.' };
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}
