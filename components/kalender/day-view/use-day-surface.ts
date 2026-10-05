'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { indexAtOffset } from '@/lib/calendar/drag-math';
import { dayMinutesAtPoint, edgeResizedSpan } from '@/lib/calendar/day-drag-geometry';
import { DAY_NAME_COLUMN_PX, MIN_ITEM_MINUTES } from '@/lib/calendar/day-layout';
import type { CalendarBoardDay, CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { DragSurface } from '../drag-engine/drag-engine';
import type {
  CalendarDragPayload,
  CalendarDragTarget,
  DragModifiers,
  DragVerdict,
} from '../drag-engine/payload';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { UNASSIGNED_USER } from '../board/types';
import { applyDayDrop } from './day-surface-drop';
import { dayTargetVerdict, jobSpanMinutes, payloadDuration, rowFor } from './day-surface-rules';

export type DayRowModel = {
  userId: string;
  name: string;
  row: CalendarBoardRow | null;
  /** Recorded blocks of the person, as instants, for the overlap check. */
  blocks: Array<{ id: string; startMs: number; endMs: number }>;
};

type SlotMap = {
  rowStarts: number[];
  rows: DayRowModel[];
  timelineLeft: number;
  horizontalScroller: HTMLElement | null;
  verticalScroller: HTMLElement | null;
  scrollLeft: number;
  scrollTop: number;
  contentTop: number;
};

export type DaySurfaceInput = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  highlightRef: React.RefObject<HTMLDivElement | null>;
  horizontalScroller: () => HTMLElement | null;
  verticalScroller: () => HTMLElement | null;
  hourWidth: number;
  dateIso: string;
  dayStart: Date;
  rows: DayRowModel[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onPark: (job: CalendarJob) => void;
  nowMs: () => number;
};

/**
 * The day view's drag surface (P1-24a, package C): rows by y, minutes by x
 * on the hour axis snapped to 15 (5 with Shift), the same pre-checks as the
 * board plus the time rules, one highlight moved by transform, and every
 * drop routed to the mutation owner.
 */
export function useDaySurface(input: DaySurfaceInput): DragSurface {
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const prepare = useCallback(() => {
    const { rootRef, horizontalScroller, verticalScroller, rows } = inputRef.current;
    const root = rootRef.current;
    if (!root) return;
    const rowElements = [...root.querySelectorAll<HTMLElement>('[data-day-row]')];
    const rowRects = rowElements.map((element) => element.getBoundingClientRect());
    const rowStarts = rowRects.map((rect) => rect.top);
    const lastRow = rowRects.at(-1);
    if (lastRow) rowStarts.push(lastRow.bottom);
    const rootRect = root.getBoundingClientRect();
    const horizontal = horizontalScroller();
    const vertical = verticalScroller();
    mapRef.current = {
      rowStarts,
      rows,
      timelineLeft: rootRect.left + DAY_NAME_COLUMN_PX,
      horizontalScroller: horizontal,
      verticalScroller: vertical,
      scrollLeft: horizontal?.scrollLeft ?? 0,
      scrollTop: vertical?.scrollTop ?? 0,
      contentTop: rootRect.top,
    };
  }, []);

  const resolveTarget = useCallback(
    (
      point: { x: number; y: number },
      payload: CalendarDragPayload,
      modifiers: DragModifiers,
      origin: { x: number; y: number },
    ): CalendarDragTarget | null => {
      const map = mapRef.current;
      const { hourWidth, dateIso } = inputRef.current;
      if (!map) return null;
      const dy = (map.verticalScroller?.scrollTop ?? 0) - map.scrollTop;
      const dx = (map.horizontalScroller?.scrollLeft ?? 0) - map.scrollLeft;
      const rowIndex = indexAtOffset(map.rowStarts, point.y + dy);
      if (rowIndex === null) return null;
      const row = map.rows[rowIndex];
      if (!row) return null;
      // The origin is the real time edge for a resize, or the card's start for a move.
      // A minimum visual width must never add minutes to a short block's resize.
      const isEdge =
        payload.kind === 'resizeJob' || payload.kind === 'resizeBlock' || payload.kind === 'barEdge';
      const minutes = dayMinutesAtPoint({
        x: payload.kind === 'barEdge' ? point.x : origin.x,
        scrollDelta: dx,
        timelineLeft: map.timelineLeft,
        hourWidth,
        fine: modifiers.fine,
      });
      // An edge drag stays on its own row, the unassigned one included.
      const targetRow =
        isEdge && payload.kind !== 'barEdge' ? (rowFor(map.rows, payload.sourceUserId) ?? row) : row;
      return {
        kind: 'cell',
        employeeRecordId: targetRow.row?.employeeRecordId ?? null,
        userId: targetRow.userId === UNASSIGNED_USER ? null : targetRow.userId,
        date: dateIso,
        minutes,
      };
    },
    [],
  );

  const checkTarget = useCallback(
    (target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers): DragVerdict =>
      dayTargetVerdict(inputRef.current, target, payload, modifiers),
    [],
  );

  const onTargetChange = useCallback(
    (target: CalendarDragTarget | null, verdict: DragVerdict | null, payload: CalendarDragPayload) => {
      const highlight = inputRef.current.highlightRef.current;
      const map = mapRef.current;
      const { hourWidth } = inputRef.current;
      if (!highlight) return;
      if (!target || target.kind !== 'cell' || !map || target.minutes === undefined) {
        highlight.hidden = true;
        return;
      }
      const targetRowKey = target.userId ?? UNASSIGNED_USER;
      const rowIndex = map.rows.findIndex((row) => row.userId === targetRowKey);
      if (rowIndex < 0) {
        highlight.hidden = true;
        return;
      }
      const top = (map.rowStarts[rowIndex] ?? 0) - map.contentTop;
      const bottom = (map.rowStarts[rowIndex + 1] ?? 0) - map.contentTop;
      let start = target.minutes;
      let end = target.minutes + payloadDuration(payload);
      if (payload.kind === 'resizeJob') {
        ({ start, end } = edgeResizedSpan({
          ...jobSpanMinutes(payload.job),
          edge: payload.edge,
          edgeAt: target.minutes,
          minimumLength: MIN_ITEM_MINUTES,
        }));
      } else if (payload.kind === 'resizeBlock') {
        const { dayStart, nowMs } = inputRef.current;
        const blockStart = payload.session.clockIn
          ? (new Date(payload.session.clockIn.timestamp).getTime() - dayStart.getTime()) / 60_000
          : 0;
        // A running session ends now, as in the drop and its verdict.
        const blockEnd =
          ((payload.session.clockOut ? new Date(payload.session.clockOut.timestamp).getTime() : nowMs()) -
            dayStart.getTime()) /
          60_000;
        ({ start, end } = edgeResizedSpan({
          start: blockStart,
          end: blockEnd,
          edge: payload.edge,
          edgeAt: target.minutes,
          minimumLength: MIN_ITEM_MINUTES,
        }));
      }
      highlight.hidden = false;
      highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
      highlight.style.transform = `translate3d(${Math.round(DAY_NAME_COLUMN_PX + (start / 60) * hourWidth)}px, ${Math.round(top)}px, 0)`;
      highlight.style.width = `${Math.max(4, Math.round(((end - start) / 60) * hourWidth))}px`;
      highlight.style.height = `${Math.round(bottom - top)}px`;
    },
    [],
  );

  const onDrop = useCallback(
    (target: CalendarDragTarget, payload: CalendarDragPayload) =>
      applyDayDrop(inputRef.current, target, payload),
    [],
  );

  return useMemo<DragSurface>(
    () => ({
      prepare,
      resolveTarget,
      checkTarget,
      onTargetChange,
      onDrop,
      onEnd: () => {
        const highlight = inputRef.current.highlightRef.current;
        if (highlight) highlight.hidden = true;
      },
      scrollContainer: () => inputRef.current.horizontalScroller(),
    }),
    [checkTarget, onDrop, onTargetChange, prepare, resolveTarget],
  );
}
