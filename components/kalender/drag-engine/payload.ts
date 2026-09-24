import type { CalendarJob } from '@/lib/jobs/types';
import type { InteractiveCalendarSession } from '@/lib/time-tracking/types';

/**
 * What a calendar drag carries (P1-24a). One union for every draggable in
 * the board, the day view, the month view and the Parkplatz, so one engine
 * serves them all and every surface's pre-check reads the same facts.
 */
export type CalendarDragPayload =
  | {
      kind: 'occurrence';
      job: CalendarJob;
      /** The row the card was taken from; null for the „Ohne Zuweisung" row. */
      sourceEmployeeRecordId: string | null;
      sourceUserId: string | null;
      sourceDate: string;
    }
  | { kind: 'parked'; job: CalendarJob }
  | { kind: 'untimed'; job: CalendarJob; sourceDate: string }
  | {
      kind: 'timeBlock';
      session: InteractiveCalendarSession;
      sourceUserId: string;
      sourceDate: string;
      durationMinutes: number;
    }
  | { kind: 'barEdge'; job: CalendarJob; edge: 'start' | 'end'; sourceEmployeeRecordId: string | null }
  /** The hour axis: a visit's start or end handle. */
  | { kind: 'resizeJob'; job: CalendarJob; edge: 'start' | 'end'; sourceUserId: string | null }
  /** The hour axis: a recorded block's start or end handle. */
  | { kind: 'resizeBlock'; session: InteractiveCalendarSession; edge: 'start' | 'end'; sourceUserId: string };

/** Where a drag can land. Surfaces resolve pointers into these; zones are panels. */
export type CalendarDragTarget =
  | {
      kind: 'cell';
      /** null is the „Ohne Zuweisung" row. */
      employeeRecordId: string | null;
      userId: string | null;
      date: string;
      /** Minutes of the day on an hour axis; absent on the board and the month. */
      minutes?: number;
    }
  | { kind: 'zone'; zone: 'parkplatz' };

export type DragModifiers = {
  /** Alt held at the drop: copy instead of move (board). */
  copy: boolean;
  /** Shift held: five-minute snapping on the hour axis. */
  fine: boolean;
};

export type DragVerdict =
  | { ok: true; label?: string }
  | { ok: false; message: string };

export function targetKey(target: CalendarDragTarget | null): string {
  if (!target) return 'none';
  if (target.kind === 'zone') return `zone:${target.zone}`;
  // A member without a board row on that day has no record id but is still a distinct row.
  return `cell:${target.employeeRecordId ?? ''}:${target.userId ?? 'unassigned'}:${target.date}:${target.minutes ?? ''}`;
}
