'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { boardRowRecordId, boardSlotAtPoint, boardSlotRect } from '@/lib/calendar/board-slots';
import type { CalendarBoardDay } from '@/lib/calendar/board';
import type { BoardColumn } from '@/lib/calendar/board-layout';
import type { BoardRowModel } from '@/lib/calendar/board-model';
import type { CalendarJob } from '@/lib/jobs/types';
import { useCalendarAnnounce } from '../surface/live-region';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget, DragModifiers } from '../drag-engine/payload';
import type { DragVerdict } from '@/lib/calendar/drag-ghost';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import type { JobParkingContext } from '@/lib/parking/types';
import { applyBoardDrop } from './board-surface-drop';
import { boardTargetVerdict } from './board-surface-rules';

/**
 * The board's drag surface (P1-24a): a slot map computed once at drag
 * start from the row and column elements, a resolver that reads only scroll
 * offsets per frame, the pre-checks of the message layer, one highlight
 * element moved by transform, and the drops routed to the mutation owner.
 */
type SlotMap = {
  rowStarts: number[];
  rows: BoardRowModel[];
  columnStarts: number[];
  columns: BoardColumn[];
  verticalScroller: HTMLElement | null;
  horizontalScroller: HTMLElement | null;
  scrollTop: number;
  scrollLeft: number;
  /** Content-space origin of the board root, for the highlight. */
  contentTop: number;
  contentLeft: number;
};

export type BoardSurfaceInput = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  highlightRef: React.RefObject<HTMLDivElement | null>;
  verticalScroller: () => HTMLElement | null;
  columns: BoardColumn[];
  rowModels: BoardRowModel[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  nowMs: () => number;
  onPark: (job: CalendarJob) => void;
  onParkedContextMissing: () => void;
  /** Focus the moved card after the drop settles in the DOM. */
  focusCard: (occurrenceId: string, employeeRecordId: string | null) => void;
};

/** Reads the row and column edges once at drag start; the resolver then only reads scroll offsets. */
function measureBoardSlotMap(
  root: HTMLElement,
  { verticalScroller, columns, rowModels }: BoardSurfaceInput,
): SlotMap {
  const rowElements = [...root.querySelectorAll<HTMLElement>('[data-board-row]')];
  const rowRects = rowElements.map((element) => element.getBoundingClientRect());
  const rowStarts = rowRects.map((rect) => rect.top);
  const lastRow = rowRects.at(-1);
  if (lastRow) rowStarts.push(lastRow.bottom);
  const columnElements = [...root.querySelectorAll<HTMLElement>('[data-board-column]')];
  const columnRects = columnElements.map((element) => element.getBoundingClientRect());
  const columnStarts = columnRects.map((rect) => rect.left);
  const lastColumn = columnRects.at(-1);
  if (lastColumn) columnStarts.push(lastColumn.right);
  const rootRect = root.getBoundingClientRect();
  // One scroller owns both axes (the page's calendar region), so sticky
  // headers and rows work against it and one delta covers each axis.
  const vertical = verticalScroller();
  return {
    rowStarts,
    rows: rowModels,
    columnStarts,
    columns,
    verticalScroller: vertical,
    horizontalScroller: vertical,
    scrollTop: vertical?.scrollTop ?? 0,
    scrollLeft: vertical?.scrollLeft ?? 0,
    contentTop: rootRect.top,
    contentLeft: rootRect.left,
  };
}

/** The cell under the pointer: the map's edges moved by what the scroller travelled since the drag began. */
function boardTargetAt(map: SlotMap, point: { x: number; y: number }): CalendarDragTarget | null {
  const dy = (map.verticalScroller?.scrollTop ?? 0) - map.scrollTop;
  const dx = (map.horizontalScroller?.scrollLeft ?? 0) - map.scrollLeft;
  const { rowStarts, columnStarts } = map;
  const slot = boardSlotAtPoint({ rowStarts, columnStarts, point, scrollDelta: { x: dx, y: dy } });
  if (!slot) return null;
  const row = map.rows[slot.rowIndex];
  const column = map.columns[slot.columnIndex];
  if (!row || !column) return null;
  return {
    kind: 'cell',
    employeeRecordId: boardRowRecordId(row),
    userId: row.kind === 'person' ? row.row.userId : null,
    date: column.date,
  };
}

/** Moves the one highlight onto the target's cell, or hides it when no cell is targeted. */
function paintBoardHighlight(
  highlight: HTMLElement | null,
  map: SlotMap | null,
  target: CalendarDragTarget | null,
  verdict: DragVerdict | null,
): void {
  if (!highlight) return;
  if (!target || target.kind !== 'cell' || !map) {
    highlight.hidden = true;
    return;
  }
  const rowIndex = map.rows.findIndex((row) => boardRowRecordId(row) === target.employeeRecordId);
  const columnIndex = map.columns.findIndex((column) => column.date === target.date);
  if (rowIndex < 0 || columnIndex < 0) {
    highlight.hidden = true;
    return;
  }
  const { rowStarts, columnStarts, contentTop, contentLeft } = map;
  const rect = boardSlotRect({ rowStarts, columnStarts, rowIndex, columnIndex, contentTop, contentLeft });
  highlight.hidden = false;
  highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
  highlight.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
}

export function useBoardSurface(input: BoardSurfaceInput): DragSurface {
  const announce = useCalendarAnnounce();
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const prepare = useCallback(() => {
    const root = inputRef.current.rootRef.current;
    if (!root) return;
    mapRef.current = measureBoardSlotMap(root, inputRef.current);
  }, []);

  const resolveTarget = useCallback((point: { x: number; y: number }): CalendarDragTarget | null => {
    const map = mapRef.current;
    if (!map) return null;
    return boardTargetAt(map, point);
  }, []);

  const checkTarget = useCallback(
    (target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers): DragVerdict =>
      boardTargetVerdict(inputRef.current, target, payload, modifiers),
    [],
  );

  const onTargetChange = useCallback((target: CalendarDragTarget | null, verdict: DragVerdict | null) => {
    paintBoardHighlight(inputRef.current.highlightRef.current, mapRef.current, target, verdict);
  }, []);

  const onDrop = useCallback(
    (target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers) =>
      applyBoardDrop(inputRef.current, announce, target, payload, modifiers),
    [announce],
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
      scrollContainer: () => inputRef.current.verticalScroller(),
    }),
    [checkTarget, onDrop, onTargetChange, prepare, resolveTarget],
  );
}
