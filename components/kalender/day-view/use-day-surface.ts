'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { indexAtOffset } from '@/lib/calendar/drag-math';
import { dayMinutesAtPoint, edgeResizedSpan } from '@/lib/calendar/day-drag-geometry';
import { DAY_NAME_COLUMN_PX, MIN_ITEM_MINUTES, wallMinutesFrom } from '@/lib/calendar/day-layout';
import type { CalendarBoardDay } from '@/lib/calendar/board';
import type { BoardPeople } from '@/lib/calendar/board-model';
import { dayRowFor, dayRowKey, type DayRowModel } from '@/lib/calendar/day-rows';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget, DragModifiers } from '../drag-engine/payload';
import type { DragVerdict } from '@/lib/calendar/drag-ghost';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { applyDayDrop } from './day-surface-drop';
import { dayTargetVerdict, jobSpanMinutes, payloadDuration } from './day-surface-rules';

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
  /** Who can work a visit by its date, so a card from „Ohne Zuweisung" replaces its leaver. */
  people: BoardPeople;
};

/** Reads the row edges once at drag start; the resolver then only reads scroll offsets. */
function measureDaySlotMap(root: HTMLElement, input: DaySurfaceInput): SlotMap {
  const { horizontalScroller, verticalScroller, rows } = input;
  const rowElements = [...root.querySelectorAll<HTMLElement>('[data-day-row]')];
  const rowRects = rowElements.map((element) => element.getBoundingClientRect());
  const rowStarts = rowRects.map((rect) => rect.top);
  const lastRow = rowRects.at(-1);
  if (lastRow) rowStarts.push(lastRow.bottom);
  const rootRect = root.getBoundingClientRect();
  const horizontal = horizontalScroller();
  const vertical = verticalScroller();
  return {
    rowStarts,
    rows,
    timelineLeft: rootRect.left + DAY_NAME_COLUMN_PX,
    horizontalScroller: horizontal,
    verticalScroller: vertical,
    scrollLeft: horizontal?.scrollLeft ?? 0,
    scrollTop: vertical?.scrollTop ?? 0,
    contentTop: rootRect.top,
  };
}

/** The row under the pointer and the snapped minutes of the card's edge. */
function dayTargetAt(
  map: SlotMap,
  { hourWidth, dateIso }: DaySurfaceInput,
  point: { x: number; y: number },
  payload: CalendarDragPayload,
  modifiers: DragModifiers,
  origin: { x: number; y: number },
): CalendarDragTarget | null {
  const dy = (map.verticalScroller?.scrollTop ?? 0) - map.scrollTop;
  const dx = (map.horizontalScroller?.scrollLeft ?? 0) - map.scrollLeft;
  const rowIndex = indexAtOffset(map.rowStarts, point.y + dy);
  if (rowIndex === null) return null;
  const row = map.rows[rowIndex];
  if (!row) return null;
  // The origin is the real time edge for a resize, or the card's start for a move.
  // A minimum visual width must never add minutes to a short block's resize.
  const minutes = dayMinutesAtPoint({
    x: payload.kind === 'barEdge' ? point.x : origin.x,
    scrollDelta: dx,
    timelineLeft: map.timelineLeft,
    hourWidth,
    fine: modifiers.fine,
  });
  // An edge drag stays on its own row, the unassigned one included.
  const targetRow =
    payload.kind === 'resizeJob' || payload.kind === 'resizeBlock'
      ? (dayRowFor(map.rows, payload.sourceRowKey) ?? row)
      : row;
  return {
    kind: 'cell',
    employeeRecordId: targetRow.row?.employeeRecordId ?? null,
    userId: targetRow.userId,
    date: dateIso,
    minutes,
  };
}

/** The span a resize would leave: the dragged edge moves, a running block ends now. */
function resizedHighlightSpan(
  { dayStart, nowMs }: DaySurfaceInput,
  minutes: number,
  payload: Extract<CalendarDragPayload, { kind: 'resizeJob' | 'resizeBlock' }>,
): { start: number; end: number } {
  if (payload.kind === 'resizeJob') {
    return edgeResizedSpan({
      ...jobSpanMinutes(payload.job),
      edge: payload.edge,
      edgeAt: minutes,
      minimumLength: MIN_ITEM_MINUTES,
    });
  }
  const blockStart = payload.session.clockIn
    ? wallMinutesFrom(dayStart, new Date(payload.session.clockIn.timestamp).getTime())
    : 0;
  // A running session ends now, as in the drop and its verdict.
  const blockEnd = wallMinutesFrom(
    dayStart,
    payload.session.clockOut ? new Date(payload.session.clockOut.timestamp).getTime() : nowMs(),
  );
  return edgeResizedSpan({
    start: blockStart,
    end: blockEnd,
    edge: payload.edge,
    edgeAt: minutes,
    minimumLength: MIN_ITEM_MINUTES,
  });
}

/** Moves the one highlight onto the target's span, or hides it when no cell is targeted. */
function paintDayHighlight(
  input: DaySurfaceInput,
  map: SlotMap | null,
  target: CalendarDragTarget | null,
  verdict: DragVerdict | null,
  payload: CalendarDragPayload,
): void {
  const highlight = input.highlightRef.current;
  const { hourWidth } = input;
  if (!highlight) return;
  if (!target || target.kind !== 'cell' || !map || target.minutes === undefined) {
    highlight.hidden = true;
    return;
  }
  const targetRowKey = dayRowKey(target);
  const rowIndex = map.rows.findIndex((row) => row.key === targetRowKey);
  if (rowIndex < 0) {
    highlight.hidden = true;
    return;
  }
  const top = (map.rowStarts[rowIndex] ?? 0) - map.contentTop;
  const bottom = (map.rowStarts[rowIndex + 1] ?? 0) - map.contentTop;
  let start = target.minutes;
  let end = target.minutes + payloadDuration(payload);
  if (payload.kind === 'resizeJob' || payload.kind === 'resizeBlock')
    ({ start, end } = resizedHighlightSpan(input, target.minutes, payload));
  highlight.hidden = false;
  highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
  highlight.style.transform = `translate3d(${Math.round(DAY_NAME_COLUMN_PX + (start / 60) * hourWidth)}px, ${Math.round(top)}px, 0)`;
  highlight.style.width = `${Math.max(4, Math.round(((end - start) / 60) * hourWidth))}px`;
  highlight.style.height = `${Math.round(bottom - top)}px`;
}

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
    const root = inputRef.current.rootRef.current;
    if (!root) return;
    mapRef.current = measureDaySlotMap(root, inputRef.current);
  }, []);

  const resolveTarget = useCallback(
    (
      point: { x: number; y: number },
      payload: CalendarDragPayload,
      modifiers: DragModifiers,
      origin: { x: number; y: number },
    ): CalendarDragTarget | null => {
      const map = mapRef.current;
      if (!map) return null;
      return dayTargetAt(map, inputRef.current, point, payload, modifiers, origin);
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
      paintDayHighlight(inputRef.current, mapRef.current, target, verdict, payload);
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
