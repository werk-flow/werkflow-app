'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget } from '../drag-engine/payload';
import type { DragVerdict } from '@/lib/calendar/drag-ghost';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { applyMonthDrop } from './month-surface-drop';
import { monthTargetVerdict } from './month-surface-rules';

type CellRect = { date: string; top: number; bottom: number; left: number; right: number };

type SlotMap = {
  cells: CellRect[];
  scroller: HTMLElement | null;
  scrollTop: number;
  scrollLeft: number;
  contentTop: number;
  contentLeft: number;
};

export type MonthSurfaceInput = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  highlightRef: React.RefObject<HTMLDivElement | null>;
  verticalScroller: () => HTMLElement | null;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onPark: (job: CalendarJob) => void;
  /** Recorded blocks per user and date, as instants, for the overlap check. */
  blocksByUserDate: ReadonlyMap<string, Array<{ id: string; startMs: number; endMs: number }>>;
  /** A recorded block cannot move onto a day of a closed period. */
  closedPeriods: readonly ClosedTimePeriod[];
  nowMs: () => number;
};

/** Reads the cell rectangles once at drag start; the resolver then only reads scroll offsets. */
function measureMonthSlotMap(root: HTMLElement, scroller: HTMLElement | null): SlotMap {
  const rootRect = root.getBoundingClientRect();
  const cells = [...root.querySelectorAll<HTMLElement>('[data-month-cell]')].map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      date: element.dataset.monthCell ?? '',
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    };
  });
  return {
    cells,
    scroller,
    scrollTop: scroller?.scrollTop ?? 0,
    scrollLeft: scroller?.scrollLeft ?? 0,
    contentTop: rootRect.top,
    contentLeft: rootRect.left,
  };
}

function cellAt(map: SlotMap, point: { x: number; y: number }): CellRect | null {
  const dy = (map.scroller?.scrollTop ?? 0) - map.scrollTop;
  const dx = (map.scroller?.scrollLeft ?? 0) - map.scrollLeft;
  const x = point.x + dx;
  const y = point.y + dy;
  return (
    map.cells.find((cell) => x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom) ?? null
  );
}

/** The day under the pointer; a visit and a recorded block keep their person. */
function monthTargetAt(
  map: SlotMap,
  point: { x: number; y: number },
  payload: CalendarDragPayload,
): CalendarDragTarget | null {
  const cell = cellAt(map, point);
  if (!cell) return null;
  const employeeRecordId = payload.kind === 'occurrence' ? payload.sourceEmployeeRecordId : null;
  const userId =
    payload.kind === 'occurrence'
      ? payload.sourceUserId
      : payload.kind === 'timeBlock'
        ? payload.sourceUserId
        : null;
  return { kind: 'cell', employeeRecordId, userId, date: cell.date };
}

/** Moves the one highlight onto the target's day, or hides it when no day is targeted. */
function paintMonthHighlight(
  highlight: HTMLElement | null,
  map: SlotMap | null,
  target: CalendarDragTarget | null,
  verdict: DragVerdict | null,
): void {
  if (!highlight) return;
  const cell =
    target?.kind === 'cell' && map ? map.cells.find((candidate) => candidate.date === target.date) : null;
  if (!cell || !map) {
    highlight.hidden = true;
    return;
  }
  highlight.hidden = false;
  highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
  highlight.style.transform = `translate3d(${Math.round(cell.left - map.contentLeft)}px, ${Math.round(cell.top - map.contentTop)}px, 0)`;
  highlight.style.width = `${Math.round(cell.right - cell.left)}px`;
  highlight.style.height = `${Math.round(cell.bottom - cell.top)}px`;
}

/**
 * The month's drag surface (P1-24a, package D): cell rectangles captured at
 * drag start, a date per pointer, the movable and time rules, one highlight,
 * and drops that change the date only (the person stays).
 */
export function useMonthSurface(input: MonthSurfaceInput): DragSurface {
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const prepare = useCallback(() => {
    const { rootRef, verticalScroller } = inputRef.current;
    const root = rootRef.current;
    if (!root) return;
    mapRef.current = measureMonthSlotMap(root, verticalScroller());
  }, []);

  const resolveTarget = useCallback(
    (point: { x: number; y: number }, payload: CalendarDragPayload): CalendarDragTarget | null => {
      const map = mapRef.current;
      if (!map) return null;
      return monthTargetAt(map, point, payload);
    },
    [],
  );

  const checkTarget = useCallback(
    (target: CalendarDragTarget, payload: CalendarDragPayload): DragVerdict =>
      monthTargetVerdict(inputRef.current, target, payload),
    [],
  );

  const onTargetChange = useCallback((target: CalendarDragTarget | null, verdict: DragVerdict | null) => {
    paintMonthHighlight(inputRef.current.highlightRef.current, mapRef.current, target, verdict);
  }, []);

  const onDrop = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload) => {
    applyMonthDrop(inputRef.current, target, payload);
  }, []);

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
      scrollContainer: () => inputRef.current.verticalScroller(),
    }),
    [checkTarget, onDrop, onTargetChange, prepare, resolveTarget],
  );
}
