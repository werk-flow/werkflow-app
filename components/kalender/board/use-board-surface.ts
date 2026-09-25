'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { indexAtOffset } from '@/lib/calendar/drag-math';
import type { CalendarBoardDay, CalendarBoardRow } from '@/lib/calendar/board';
import { addLocalDays } from '@/lib/planning/date-time';
import type { BoardColumn } from '@/lib/calendar/board-layout';
import { reassignmentChanges, type BoardRowModel } from '@/lib/calendar/board-model';
import { checkParkedContext, checkNotAlreadyAssigned, checkOccurrenceMovable, checkParkable, checkPersonDay, checkReadOnly, dayFor } from '@/lib/calendar/refusal-checks';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import { useCalendarAnnounce } from '../surface/live-region';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget, DragModifiers, DragVerdict } from '../drag-engine/payload';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import type { JobParkingContext } from '@/lib/parking/types';

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
  readOnly: boolean;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onPark: (job: CalendarJob) => void;
  onParkedContextMissing: () => void;
  /** Focus the moved card after the drop settles in the DOM. */
  focusCard: (occurrenceId: string, employeeRecordId: string | null) => void;
};

function rowName(row: BoardRowModel): string {
  return row.kind === 'person' ? row.row.displayName : 'Ohne Zuweisung';
}

export function moveSuccessMessage(changes: { plannedDate?: string; assignedUserIds?: string[] }, targetName: string, dateLabel: string): string {
  const rowChanged = changes.assignedUserIds !== undefined;
  const dateChanged = changes.plannedDate !== undefined;
  if (rowChanged && dateChanged) return `Termin wurde zu ${targetName} auf ${dateLabel} verschoben.`;
  if (rowChanged) return `Termin wurde zu ${targetName} verschoben.`;
  return `Termin wurde auf ${dateLabel} verschoben.`;
}

export function useBoardSurface(input: BoardSurfaceInput): DragSurface {
  const announce = useCalendarAnnounce();
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => { inputRef.current = input; });

  const prepare = useCallback(() => {
    const { rootRef, verticalScroller, columns, rowModels } = inputRef.current;
    const root = rootRef.current;
    if (!root) return;
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
    mapRef.current = {
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
  }, []);

  const resolveTarget = useCallback((point: { x: number; y: number }): CalendarDragTarget | null => {
    const map = mapRef.current;
    if (!map) return null;
    const dy = (map.verticalScroller?.scrollTop ?? 0) - map.scrollTop;
    const dx = (map.horizontalScroller?.scrollLeft ?? 0) - map.scrollLeft;
    const rowIndex = indexAtOffset(map.rowStarts, point.y + dy);
    const columnIndex = indexAtOffset(map.columnStarts, point.x + dx);
    if (rowIndex === null || columnIndex === null) return null;
    const row = map.rows[rowIndex];
    const column = map.columns[columnIndex];
    if (!row || !column) return null;
    return { kind: 'cell', employeeRecordId: row.kind === 'person' ? row.row.employeeRecordId : null, userId: row.kind === 'person' ? row.row.userId : null, date: column.date };
  }, []);

  const checkTarget = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers): DragVerdict => {
    const { readOnly, days, rowModels, parkingContexts } = inputRef.current;
    const readOnlyCheck = checkReadOnly(readOnly);
    if (!readOnlyCheck.ok) return { ok: false, message: readOnlyCheck.message };
    if (payload.kind === 'parked' && target.kind !== 'zone') {
      const parked = checkParkedContext(parkingContexts, payload.job);
      if (!parked.ok) return { ok: false, message: parked.message };
    }
    if (target.kind === 'zone') {
      if (payload.kind === 'parked') return { ok: false, message: 'Die Karte ist schon geparkt.' };
      if (payload.kind !== 'occurrence') return { ok: false, message: 'Nur Termine lassen sich parken.' };
      const parkable = checkParkable(payload.job);
      return parkable.ok ? { ok: true, label: 'Parken' } : { ok: false, message: parkable.message };
    }
    const row = rowModels.find((model) => (model.kind === 'person' ? model.row.employeeRecordId : null) === target.employeeRecordId) ?? null;
    const boardRow: CalendarBoardRow | null = row?.kind === 'person' ? row.row : null;
    const day = dayFor(days, target.employeeRecordId, target.date);
    if (payload.kind === 'occurrence' || payload.kind === 'barEdge') {
      const movable = checkOccurrenceMovable(payload.job);
      if (!movable.ok) return { ok: false, message: movable.message };
    }
    if (payload.kind === 'occurrence' && target.employeeRecordId !== payload.sourceEmployeeRecordId) {
      const assigned = checkNotAlreadyAssigned(payload.job, target.employeeRecordId, payload.sourceEmployeeRecordId, boardRow?.displayName ?? null);
      if (!assigned.ok) return { ok: false, message: assigned.message };
    }
    if (payload.kind === 'timeBlock') return { ok: false, message: 'Ist-Zeiten werden in der Tagesansicht verschoben.' };
    const person = checkPersonDay({ row: boardRow, day, date: target.date, allowWarnings: modifiers.fine });
    if (!person.ok) return { ok: false, message: person.message };
    const label = payload.kind === 'occurrence' && modifiers.copy ? `Kopie: ${rowName(row ?? { key: 'unassigned', kind: 'unassigned', row: null })}, ${formatRefusalDate(target.date)}` : `${rowName(row ?? { key: 'unassigned', kind: 'unassigned', row: null })}, ${formatRefusalDate(target.date)}`;
    return { ok: true, label };
  }, []);

  const onTargetChange = useCallback((target: CalendarDragTarget | null, verdict: DragVerdict | null) => {
    const highlight = inputRef.current.highlightRef.current;
    const map = mapRef.current;
    if (!highlight) return;
    if (!target || target.kind !== 'cell' || !map) { highlight.hidden = true; return; }
    const rowIndex = map.rows.findIndex((row) => (row.kind === 'person' ? row.row.employeeRecordId : null) === target.employeeRecordId);
    const columnIndex = map.columns.findIndex((column) => column.date === target.date);
    if (rowIndex < 0 || columnIndex < 0) { highlight.hidden = true; return; }
    const top = (map.rowStarts[rowIndex] ?? 0) - map.contentTop;
    const bottom = (map.rowStarts[rowIndex + 1] ?? 0) - map.contentTop;
    const left = (map.columnStarts[columnIndex] ?? 0) - map.contentLeft;
    const right = (map.columnStarts[columnIndex + 1] ?? 0) - map.contentLeft;
    highlight.hidden = false;
    highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
    highlight.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    highlight.style.width = `${Math.round(right - left)}px`;
    highlight.style.height = `${Math.round(bottom - top)}px`;
  }, []);

  const onDrop = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers) => {
    const { mutations, rowModels, parkingContexts, onPark, onParkedContextMissing, focusCard } = inputRef.current;
    if (target.kind === 'zone') {
      if (payload.kind === 'occurrence') onPark(payload.job);
      return;
    }
    const targetRow = rowModels.find((model) => (model.kind === 'person' ? model.row.employeeRecordId : null) === target.employeeRecordId) ?? null;
    const targetName = targetRow ? rowName(targetRow) : 'Ohne Zuweisung';
    const dateLabel = formatRefusalDate(target.date);
    if (payload.kind === 'occurrence') {
      const { job } = payload;
      if (modifiers.copy && job.occurrenceId) {
        void mutations.copyJob({ job, plannedDate: target.date, employeeRecordIds: target.employeeRecordId ? [target.employeeRecordId] : [], successMessage: `Kopie für ${targetName} am ${dateLabel} wurde angelegt.` });
        return;
      }
      const changes = reassignmentChanges({ job, sourceEmployeeRecordId: payload.sourceEmployeeRecordId, sourceUserId: payload.sourceUserId, target });
      if (!changes) return;
      void mutations.moveJob({
        job,
        changes,
        successMessage: moveSuccessMessage(changes, targetName, dateLabel),
        context: { name: targetName, date: dateLabel },
      }).then((moved) => { if (moved) focusCard(job.occurrenceId ?? job.id, target.employeeRecordId); });
      return;
    }
    if (payload.kind === 'barEdge') {
      const { job, edge } = payload;
      const startDate = job.plannedDate;
      const endDateExclusive = job.endDateExclusive ?? (startDate ? addLocalDays(startDate, 1) : null);
      if (!startDate || !endDateExclusive || !job.occurrenceId) return;
      const nextStart = edge === 'start' ? (target.date < endDateExclusive ? target.date : startDate) : startDate;
      const nextEndExclusive = edge === 'end' ? (target.date >= nextStart ? addLocalDays(target.date, 1) : endDateExclusive) : endDateExclusive;
      const durationDays = Math.round((Date.parse(`${nextEndExclusive}T00:00:00Z`) - Date.parse(`${nextStart}T00:00:00Z`)) / 86_400_000);
      if (durationDays < 1 || (nextStart === startDate && nextEndExclusive === endDateExclusive)) return;
      void mutations.moveJob({
        job,
        changes: { plannedDate: nextStart, durationDays },
        successMessage: `Termin dauert jetzt bis ${formatRefusalDate(addLocalDays(nextEndExclusive, -1))}.`,
        context: { date: dateLabel },
      });
      return;
    }
    if (payload.kind === 'parked') {
      const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
      if (!context) { onParkedContextMissing(); return; }
      void mutations.unparkJob({
        job: payload.job,
        parkingContext: context,
        plannedDate: target.date,
        ...(target.userId ? { assignToUserId: target.userId } : {}),
        successMessage: `Auftrag wurde bei ${targetName} am ${dateLabel} eingeplant.`,
        context: { name: targetName, date: dateLabel },
      });
      return;
    }
    if (payload.kind === 'untimed') {
      announce('Ungeplante Aufträge werden in der Tagesansicht auf eine Uhrzeit gelegt.');
    }
  }, [announce]);

  return useMemo<DragSurface>(() => ({
    prepare,
    resolveTarget,
    checkTarget,
    onTargetChange,
    onDrop,
    onEnd: () => { const highlight = inputRef.current.highlightRef.current; if (highlight) highlight.hidden = true; },
    scrollContainer: () => inputRef.current.verticalScroller(),
  }), [checkTarget, onDrop, onTargetChange, prepare, resolveTarget]);
}
