import { findBoardRowModel } from '@/lib/calendar/board-slots';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { BoardRowModel } from '@/lib/calendar/board-model';
import {
  checkParkedContext,
  checkNotAlreadyAssigned,
  checkOccurrenceMovable,
  checkParkable,
  checkPersonDay,
  dayFor,
} from '@/lib/calendar/refusal-checks';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarDragPayload, CalendarDragTarget, DragModifiers } from '../drag-engine/payload';
import type { DragVerdict } from '@/lib/calendar/drag-ghost';
import type { BoardSurfaceInput } from './use-board-surface';

export function boardRowName(row: BoardRowModel): string {
  return row.kind === 'person' ? row.row.displayName : 'Ohne Zuweisung';
}

/**
 * The board's pre-check for one target: the parked context, the Parkplatz
 * zone, the movable and assignment rules and the person's day. A valid target
 * names the row and the date.
 */
export function boardTargetVerdict(
  input: BoardSurfaceInput,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
  modifiers: DragModifiers,
): DragVerdict {
  const { days, rowModels, parkingContexts, nowMs } = input;
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
  const row = findBoardRowModel(rowModels, target.employeeRecordId);
  const boardRow: CalendarBoardRow | null = row?.kind === 'person' ? row.row : null;
  const day = dayFor(days, target.employeeRecordId, target.date);
  if (payload.kind === 'occurrence' || payload.kind === 'barEdge') {
    const movable = checkOccurrenceMovable(payload.job, nowMs());
    if (!movable.ok) return { ok: false, message: movable.message };
  }
  if (payload.kind === 'occurrence' && target.employeeRecordId !== payload.sourceEmployeeRecordId) {
    const assigned = checkNotAlreadyAssigned(
      payload.job,
      target.employeeRecordId,
      payload.sourceEmployeeRecordId,
      boardRow?.displayName ?? null,
    );
    if (!assigned.ok) return { ok: false, message: assigned.message };
  }
  if (payload.kind === 'timeBlock')
    return { ok: false, message: calendarRefusalMessage('time_block_moves_in_day_view') ?? '' };
  const person = checkPersonDay({ row: boardRow, day, date: target.date, allowWarnings: modifiers.fine });
  if (!person.ok) return { ok: false, message: person.message };
  const label =
    payload.kind === 'occurrence' && modifiers.copy
      ? `Kopie: ${boardRowName(row ?? { key: 'unassigned', kind: 'unassigned', row: null })}, ${formatRefusalDate(target.date)}`
      : `${boardRowName(row ?? { key: 'unassigned', kind: 'unassigned', row: null })}, ${formatRefusalDate(target.date)}`;
  return { ok: true, label };
}
