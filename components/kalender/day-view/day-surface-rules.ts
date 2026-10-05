import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { edgeResizedSpan } from '@/lib/calendar/day-drag-geometry';
import { DEFAULT_VISIT_MINUTES, MIN_ITEM_MINUTES, jobStartMinutes } from '@/lib/calendar/day-layout';
import {
  checkParkedContext,
  checkNotAlreadyAssigned,
  checkOccurrenceMovable,
  checkPersonDay,
  checkTimeBlockTarget,
  dayFor,
} from '@/lib/calendar/refusal-checks';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type {
  CalendarDragPayload,
  CalendarDragTarget,
  DragModifiers,
  DragVerdict,
} from '../drag-engine/payload';
import { UNASSIGNED_USER } from '../board/types';
import type { DaySurfaceInput } from './use-day-surface';

/** The row of a target user id; null addresses the „Ohne Zuweisung" row. */
export function rowFor<Row extends { userId: string }>(
  rows: readonly Row[],
  userId: string | null,
): Row | null {
  const key = userId ?? UNASSIGNED_USER;
  return rows.find((candidate) => candidate.userId === key) ?? null;
}

export function payloadDuration(payload: CalendarDragPayload): number {
  switch (payload.kind) {
    case 'occurrence':
    case 'untimed':
    case 'parked':
      return payload.job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES;
    case 'timeBlock':
      return payload.durationMinutes;
    default:
      return 0;
  }
}

/** A planned visit's start and end in minutes of its day. */
export function jobSpanMinutes(job: CalendarJob): { start: number; end: number } {
  const start = jobStartMinutes(job);
  return { start, end: start + (job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES) };
}

/**
 * The day view's pre-check for one target: the board's refusal rules plus the
 * time rules (the visit stays inside the day, a recorded block keeps clear of
 * the person's other blocks and of the future). A valid target names the
 * person and the resulting time span.
 */
export function dayTargetVerdict(
  input: DaySurfaceInput,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
  modifiers: DragModifiers,
): DragVerdict {
  const { days, rows, dayStart, nowMs, dateIso, parkingContexts } = input;
  if (payload.kind === 'parked' && target.kind !== 'zone') {
    const parked = checkParkedContext(parkingContexts, payload.job);
    if (!parked.ok) return { ok: false, message: parked.message };
  }
  if (target.kind === 'zone') {
    if (payload.kind === 'occurrence' || payload.kind === 'untimed') return { ok: true, label: 'Parken' };
    return { ok: false, message: calendarRefusalMessage('only_occurrences_park') ?? '' };
  }
  const minutes = target.minutes ?? 0;
  const row = rowFor(rows, target.userId);
  const name = row?.name ?? 'Ohne Zuweisung';
  const day = dayFor(days, target.employeeRecordId, target.date);
  const timeLabel = (start: number, end: number) =>
    `${name}, ${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}`;
  switch (payload.kind) {
    case 'occurrence':
    case 'untimed':
    case 'parked': {
      const duration = payloadDuration(payload);
      if (payload.kind !== 'parked') {
        const movable = checkOccurrenceMovable(payload.job, nowMs());
        if (!movable.ok) return { ok: false, message: movable.message };
      }
      if (payload.kind === 'occurrence' && target.employeeRecordId !== payload.sourceEmployeeRecordId) {
        const assigned = checkNotAlreadyAssigned(
          payload.job,
          target.employeeRecordId,
          payload.sourceEmployeeRecordId,
          name,
        );
        if (!assigned.ok) return { ok: false, message: assigned.message };
      }
      const person = checkPersonDay({
        row: row?.row ?? null,
        day,
        date: target.date,
        allowWarnings: modifiers.fine,
      });
      if (!person.ok) return { ok: false, message: person.message };
      if (minutes + duration > 24 * 60)
        return { ok: false, message: calendarRefusalMessage('outside_day') ?? '' };
      return { ok: true, label: timeLabel(minutes, minutes + duration) };
    }
    case 'resizeJob': {
      const movable = checkOccurrenceMovable(payload.job, nowMs());
      if (!movable.ok) return { ok: false, message: movable.message };
      const next = edgeResizedSpan({
        ...jobSpanMinutes(payload.job),
        edge: payload.edge,
        edgeAt: minutes,
        minimumLength: MIN_ITEM_MINUTES,
      });
      if (next.end > 24 * 60) return { ok: false, message: calendarRefusalMessage('outside_day') ?? '' };
      return { ok: true, label: timeLabel(next.start, next.end) };
    }
    case 'timeBlock':
    case 'resizeBlock': {
      const session = payload.session;
      const clockInMs = session.clockIn ? new Date(session.clockIn.timestamp).getTime() : dayStart.getTime();
      const clockOutMs = session.clockOut ? new Date(session.clockOut.timestamp).getTime() : nowMs();
      let startMs: number;
      let endMs: number;
      if (payload.kind === 'timeBlock') {
        startMs = dayStart.getTime() + minutes * 60_000;
        endMs = startMs + (clockOutMs - clockInMs);
      } else {
        const next = edgeResizedSpan({
          start: clockInMs,
          end: clockOutMs,
          edge: payload.edge,
          edgeAt: dayStart.getTime() + minutes * 60_000,
          minimumLength: MIN_ITEM_MINUTES * 60_000,
        });
        startMs = next.start;
        endMs = next.end;
      }
      if (!row || target.userId === null)
        return { ok: false, message: calendarRefusalMessage('time_block_needs_person') ?? '' };
      const blockId = session.calendarBlockId ?? null;
      const check = checkTimeBlockTarget({
        startMs,
        endMs,
        nowMs: nowMs(),
        targetName: name,
        otherBlocks: row.blocks.filter((block) => block.id !== blockId),
      });
      if (!check.ok) return { ok: false, message: check.message };
      return {
        ok: true,
        label: timeLabel((startMs - dayStart.getTime()) / 60_000, (endMs - dayStart.getTime()) / 60_000),
      };
    }
    case 'barEdge':
      return {
        ok: false,
        message:
          calendarRefusalMessage('all_day_extends_on_board', { date: formatRefusalDate(dateIso) }) ?? '',
      };
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}
