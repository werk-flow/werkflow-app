'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { checkParkedContext, checkOccurrenceMovable, checkParkable, checkReadOnly, checkTimeBlockTarget } from '@/lib/calendar/refusal-checks';
import { formatRefusalDate } from '@/lib/calendar/messages';
import { shiftedBlockUpdates } from '@/lib/calendar/day-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget, DragVerdict } from '../drag-engine/payload';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';

type CellRect = { date: string; top: number; bottom: number; left: number; right: number };

type SlotMap = { cells: CellRect[]; scroller: HTMLElement | null; scrollTop: number; scrollLeft: number; contentTop: number; contentLeft: number };

export type MonthSurfaceInput = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  highlightRef: React.RefObject<HTMLDivElement | null>;
  verticalScroller: () => HTMLElement | null;
  readOnly: boolean;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onPark: (job: CalendarJob) => void;
  /** Recorded blocks per user and date, as instants, for the overlap check. */
  blocksByUserDate: ReadonlyMap<string, Array<{ id: string; startMs: number; endMs: number }>>;
  nowMs: () => number;
};

function dayDelta(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * The month's drag surface (P1-24a, package D): cell rectangles captured at
 * drag start, a date per pointer, the movable and time rules, one highlight,
 * and drops that change the date only (the person stays).
 */
export function useMonthSurface(input: MonthSurfaceInput): DragSurface {
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => { inputRef.current = input; });

  const prepare = useCallback(() => {
    const { rootRef, verticalScroller } = inputRef.current;
    const root = rootRef.current;
    if (!root) return;
    const scroller = verticalScroller();
    const rootRect = root.getBoundingClientRect();
    const cells = [...root.querySelectorAll<HTMLElement>('[data-month-cell]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { date: element.dataset.monthCell ?? '', top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    mapRef.current = { cells, scroller, scrollTop: scroller?.scrollTop ?? 0, scrollLeft: scroller?.scrollLeft ?? 0, contentTop: rootRect.top, contentLeft: rootRect.left };
  }, []);

  const cellAt = (map: SlotMap, point: { x: number; y: number }): CellRect | null => {
    const dy = (map.scroller?.scrollTop ?? 0) - map.scrollTop;
    const dx = (map.scroller?.scrollLeft ?? 0) - map.scrollLeft;
    const x = point.x + dx;
    const y = point.y + dy;
    return map.cells.find((cell) => x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom) ?? null;
  };

  const resolveTarget = useCallback((point: { x: number; y: number }, payload: CalendarDragPayload): CalendarDragTarget | null => {
    const map = mapRef.current;
    if (!map) return null;
    const cell = cellAt(map, point);
    if (!cell) return null;
    const employeeRecordId = payload.kind === 'occurrence' ? payload.sourceEmployeeRecordId : null;
    const userId = payload.kind === 'occurrence' ? payload.sourceUserId : payload.kind === 'timeBlock' ? payload.sourceUserId : null;
    return { kind: 'cell', employeeRecordId, userId, date: cell.date };
  }, []);

  const checkTarget = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload): DragVerdict => {
    const { readOnly, blocksByUserDate, nowMs, parkingContexts } = inputRef.current;
    const readOnlyCheck = checkReadOnly(readOnly);
    if (!readOnlyCheck.ok) return { ok: false, message: readOnlyCheck.message };
    if (payload.kind === 'parked' && target.kind !== 'zone') {
      const parked = checkParkedContext(parkingContexts, payload.job);
      if (!parked.ok) return { ok: false, message: parked.message };
    }
    if (target.kind === 'zone') {
      if (payload.kind !== 'occurrence') return { ok: false, message: 'Nur Termine lassen sich parken.' };
      const parkable = checkParkable(payload.job);
      return parkable.ok ? { ok: true, label: 'Parken' } : { ok: false, message: parkable.message };
    }
    const dateLabel = formatRefusalDate(target.date);
    switch (payload.kind) {
      case 'occurrence': {
        const movable = checkOccurrenceMovable(payload.job);
        return movable.ok ? { ok: true, label: dateLabel } : { ok: false, message: movable.message };
      }
      case 'parked':
        return { ok: true, label: dateLabel };
      case 'timeBlock': {
        const { session } = payload;
        if (!session.clockIn || !session.clockOut) return { ok: false, message: 'Offene Arbeitszeit lässt sich nicht verschieben.' };
        const delta = dayDelta(payload.sourceDate, target.date) * 86_400_000;
        const startMs = new Date(session.clockIn.timestamp).getTime() + delta;
        const endMs = new Date(session.clockOut.timestamp).getTime() + delta;
        const others = (blocksByUserDate.get(`${payload.sourceUserId}:${target.date}`) ?? []).filter((block) => block.id !== session.calendarBlockId);
        const check = checkTimeBlockTarget({ startMs, endMs, nowMs: nowMs(), targetName: null, otherBlocks: others });
        return check.ok ? { ok: true, label: dateLabel } : { ok: false, message: check.message };
      }
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
  }, []);

  const onTargetChange = useCallback((target: CalendarDragTarget | null, verdict: DragVerdict | null) => {
    const highlight = inputRef.current.highlightRef.current;
    const map = mapRef.current;
    if (!highlight) return;
    const cell = target?.kind === 'cell' && map ? map.cells.find((candidate) => candidate.date === target.date) : null;
    if (!cell || !map) { highlight.hidden = true; return; }
    highlight.hidden = false;
    highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
    highlight.style.transform = `translate3d(${Math.round(cell.left - map.contentLeft)}px, ${Math.round(cell.top - map.contentTop)}px, 0)`;
    highlight.style.width = `${Math.round(cell.right - cell.left)}px`;
    highlight.style.height = `${Math.round(cell.bottom - cell.top)}px`;
  }, []);

  const onDrop = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload) => {
    const { mutations, parkingContexts, onPark, onParkedContextMissing } = inputRef.current;
    if (target.kind === 'zone') {
      if (payload.kind === 'occurrence') onPark(payload.job);
      return;
    }
    const dateLabel = formatRefusalDate(target.date);
    if (payload.kind === 'occurrence') {
      const { job } = payload;
      if (job.plannedDate === target.date) return;
      void mutations.moveJob({ job, changes: { plannedDate: target.date }, successMessage: `Termin wurde auf ${dateLabel} verschoben.`, context: { date: dateLabel } });
      return;
    }
    if (payload.kind === 'parked') {
      const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
      if (!context) { onParkedContextMissing(); return; }
      void mutations.unparkJob({ job: payload.job, parkingContext: context, plannedDate: target.date, successMessage: `Auftrag wurde am ${dateLabel} eingeplant.`, context: { date: dateLabel } });
      return;
    }
    if (payload.kind === 'timeBlock') {
      const { session } = payload;
      if (!session.clockIn || target.date === payload.sourceDate) return;
      const sourceEntries = session.sourceEntries ?? [session.clockIn, ...(session.clockOut ? [session.clockOut] : [])];
      void mutations.moveTimeBlock({
        sourceEntries,
        updates: shiftedBlockUpdates(sourceEntries, dayDelta(payload.sourceDate, target.date) * 86_400_000, payload.sourceUserId),
        successMessage: `Arbeitszeit wurde auf ${dateLabel} verschoben.`,
        context: { date: dateLabel },
      });
    }
  }, []);

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
