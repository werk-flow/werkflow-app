'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { formatMinutesOfDay, indexAtOffset, snapMinutes } from '@/lib/calendar/drag-math';
import { DAY_NAME_COLUMN_PX, DEFAULT_VISIT_MINUTES, MIN_ITEM_MINUTES, resizedBlockUpdates, shiftedBlockUpdates, jobStartMinutes } from '@/lib/calendar/day-layout';
import type { CalendarBoardDay, CalendarBoardRow } from '@/lib/calendar/board';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { checkNotAlreadyAssigned, checkOccurrenceMovable, checkPersonDay, checkReadOnly, checkTimeBlockTarget, dayFor } from '@/lib/calendar/refusal-checks';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import type { DragSurface } from '../drag-engine/drag-engine';
import type { CalendarDragPayload, CalendarDragTarget, DragModifiers, DragVerdict } from '../drag-engine/payload';
import type { CalendarMutations } from '../mutations/use-calendar-mutations';
import { moveSuccessMessage } from '../board/use-board-surface';
import { UNASSIGNED_USER } from '../board/types';

/** The row of a target user id; null addresses the „Ohne Zuweisung" row. */
function rowFor<Row extends { userId: string }>(rows: readonly Row[], userId: string | null): Row | null {
  const key = userId ?? UNASSIGNED_USER;
  return rows.find((candidate) => candidate.userId === key) ?? null;
}

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
  readOnly: boolean;
  mutations: CalendarMutations;
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onParkedContextMissing: () => void;
  onPark: (job: CalendarJob) => void;
  nowMs: () => number;
};

function payloadDuration(payload: CalendarDragPayload): number {
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

/**
 * The day view's drag surface (P1-24a, package C): rows by y, minutes by x
 * on the hour axis snapped to 15 (5 with Shift), the same pre-checks as the
 * board plus the time rules, one highlight moved by transform, and every
 * drop routed to the mutation owner.
 */
export function useDaySurface(input: DaySurfaceInput): DragSurface {
  const mapRef = useRef<SlotMap | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => { inputRef.current = input; });

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

  const resolveTarget = useCallback((point: { x: number; y: number }, payload: CalendarDragPayload, modifiers: DragModifiers, origin: { x: number; y: number }): CalendarDragTarget | null => {
    const map = mapRef.current;
    const { hourWidth, dateIso } = inputRef.current;
    if (!map) return null;
    const dy = (map.verticalScroller?.scrollTop ?? 0) - map.scrollTop;
    const dx = (map.horizontalScroller?.scrollLeft ?? 0) - map.scrollLeft;
    const rowIndex = indexAtOffset(map.rowStarts, point.y + dy);
    if (rowIndex === null) return null;
    const row = map.rows[rowIndex];
    if (!row) return null;
    // An edge drag reads the pointer; a body drag reads the card's left edge, so the
    // card lands where the planner sees it, not where the finger holds it.
    const isEdge = payload.kind === 'resizeJob' || payload.kind === 'resizeBlock' || payload.kind === 'barEdge';
    const rawMinutes = (((isEdge ? point.x : origin.x) + dx - map.timelineLeft) / hourWidth) * 60;
    const minutes = snapMinutes(rawMinutes, modifiers.fine ? 5 : 15);
    // An edge drag stays on its own row, the unassigned one included.
    const targetRow = isEdge && payload.kind !== 'barEdge' ? rowFor(map.rows, payload.sourceUserId) ?? row : row;
    return { kind: 'cell', employeeRecordId: targetRow.row?.employeeRecordId ?? null, userId: targetRow.userId === UNASSIGNED_USER ? null : targetRow.userId, date: dateIso, minutes: Math.max(0, Math.min(24 * 60, minutes)) };
  }, []);

  const checkTarget = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers): DragVerdict => {
    const { readOnly, days, rows, dayStart, nowMs, dateIso } = inputRef.current;
    const readOnlyCheck = checkReadOnly(readOnly);
    if (!readOnlyCheck.ok) return { ok: false, message: readOnlyCheck.message };
    if (target.kind === 'zone') {
      if (payload.kind === 'occurrence' || payload.kind === 'untimed') return { ok: true, label: 'Parken' };
      return { ok: false, message: 'Nur Termine lassen sich parken.' };
    }
    const minutes = target.minutes ?? 0;
    const row = rowFor(rows, target.userId);
    const name = row?.name ?? 'Ohne Zuweisung';
    const day = dayFor(days, target.employeeRecordId, target.date);
    const timeLabel = (start: number, end: number) => `${name}, ${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}`;
    switch (payload.kind) {
      case 'occurrence':
      case 'untimed':
      case 'parked': {
        const duration = payloadDuration(payload);
        if (payload.kind !== 'parked') {
          const movable = checkOccurrenceMovable(payload.job);
          if (!movable.ok) return { ok: false, message: movable.message };
        }
        if (payload.kind === 'occurrence' && target.employeeRecordId !== payload.sourceEmployeeRecordId) {
          const assigned = checkNotAlreadyAssigned(payload.job, target.employeeRecordId, payload.sourceEmployeeRecordId, name);
          if (!assigned.ok) return { ok: false, message: assigned.message };
        }
        const person = checkPersonDay({ row: row?.row ?? null, day, date: target.date, allowWarnings: modifiers.fine });
        if (!person.ok) return { ok: false, message: person.message };
        if (minutes + duration > 24 * 60) return { ok: false, message: calendarRefusalMessage('outside_day') ?? '' };
        return { ok: true, label: timeLabel(minutes, minutes + duration) };
      }
      case 'resizeJob': {
        const start = jobStartMinutes(payload.job);
        const end = start + (payload.job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES);
        const nextStart = payload.edge === 'start' ? Math.min(minutes, end - MIN_ITEM_MINUTES) : start;
        const nextEnd = payload.edge === 'end' ? Math.max(minutes, start + MIN_ITEM_MINUTES) : end;
        if (nextEnd > 24 * 60) return { ok: false, message: calendarRefusalMessage('outside_day') ?? '' };
        return { ok: true, label: timeLabel(nextStart, nextEnd) };
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
          const edgeMs = dayStart.getTime() + minutes * 60_000;
          startMs = payload.edge === 'start' ? Math.min(edgeMs, clockOutMs - MIN_ITEM_MINUTES * 60_000) : clockInMs;
          endMs = payload.edge === 'end' ? Math.max(edgeMs, clockInMs + MIN_ITEM_MINUTES * 60_000) : clockOutMs;
        }
        if (!row || target.userId === null) return { ok: false, message: 'Arbeitszeit braucht eine Person.' };
        const blockId = session.calendarBlockId ?? null;
        const check = checkTimeBlockTarget({ startMs, endMs, nowMs: nowMs(), targetName: name, otherBlocks: row.blocks.filter((block) => block.id !== blockId) });
        if (!check.ok) return { ok: false, message: check.message };
        return { ok: true, label: timeLabel((startMs - dayStart.getTime()) / 60_000, (endMs - dayStart.getTime()) / 60_000) };
      }
      case 'barEdge':
        return { ok: false, message: `Ganztägige Termine werden auf der Plantafel verlängert (${formatRefusalDate(dateIso)}).` };
      default: {
        const exhaustive: never = payload;
        return exhaustive;
      }
    }
  }, []);

  const onTargetChange = useCallback((target: CalendarDragTarget | null, verdict: DragVerdict | null, payload: CalendarDragPayload) => {
    const highlight = inputRef.current.highlightRef.current;
    const map = mapRef.current;
    const { hourWidth } = inputRef.current;
    if (!highlight) return;
    if (!target || target.kind !== 'cell' || !map || target.minutes === undefined) { highlight.hidden = true; return; }
    const rowIndex = map.rows.findIndex((row) => row.userId === target.userId);
    if (rowIndex < 0) { highlight.hidden = true; return; }
    const top = (map.rowStarts[rowIndex] ?? 0) - map.contentTop;
    const bottom = (map.rowStarts[rowIndex + 1] ?? 0) - map.contentTop;
    let start = target.minutes;
    let end = target.minutes + payloadDuration(payload);
    if (payload.kind === 'resizeJob') {
      const jobStart = jobStartMinutes(payload.job);
      const jobEnd = jobStart + (payload.job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES);
      start = payload.edge === 'start' ? Math.min(target.minutes, jobEnd - MIN_ITEM_MINUTES) : jobStart;
      end = payload.edge === 'end' ? Math.max(target.minutes, jobStart + MIN_ITEM_MINUTES) : jobEnd;
    } else if (payload.kind === 'resizeBlock') {
      const { dayStart } = inputRef.current;
      const blockStart = payload.session.clockIn ? (new Date(payload.session.clockIn.timestamp).getTime() - dayStart.getTime()) / 60_000 : 0;
      const blockEnd = payload.session.clockOut ? (new Date(payload.session.clockOut.timestamp).getTime() - dayStart.getTime()) / 60_000 : blockStart + MIN_ITEM_MINUTES;
      start = payload.edge === 'start' ? Math.min(target.minutes, blockEnd - MIN_ITEM_MINUTES) : blockStart;
      end = payload.edge === 'end' ? Math.max(target.minutes, blockStart + MIN_ITEM_MINUTES) : blockEnd;
    }
    highlight.hidden = false;
    highlight.dataset.state = verdict?.ok ? 'valid' : 'refused';
    highlight.style.transform = `translate3d(${Math.round(DAY_NAME_COLUMN_PX + (start / 60) * hourWidth)}px, ${Math.round(top)}px, 0)`;
    highlight.style.width = `${Math.max(4, Math.round(((end - start) / 60) * hourWidth))}px`;
    highlight.style.height = `${Math.round(bottom - top)}px`;
  }, []);

  const onDrop = useCallback((target: CalendarDragTarget, payload: CalendarDragPayload) => {
    const { mutations, rows, parkingContexts, onPark, onParkedContextMissing, dayStart, nowMs, dateIso } = inputRef.current;
    if (target.kind === 'zone') {
      if (payload.kind === 'occurrence' || payload.kind === 'untimed') onPark(payload.job);
      return;
    }
    const minutes = target.minutes ?? 0;
    const row = rowFor(rows, target.userId);
    const name = row?.name ?? 'Ohne Zuweisung';
    const time = formatMinutesOfDay(minutes);
    const dateLabel = formatRefusalDate(dateIso);
    switch (payload.kind) {
      case 'occurrence':
      case 'untimed': {
        const { job } = payload;
        const sourceRecordId = payload.kind === 'occurrence' ? payload.sourceEmployeeRecordId : (rows.find((candidate) => job.assignedUserIds.includes(candidate.userId))?.row?.employeeRecordId ?? null);
        const sourceUserId = payload.kind === 'occurrence' ? payload.sourceUserId : (job.assignedUserIds.find((userId) => rows.some((candidate) => candidate.userId === userId)) ?? null);
        const reassign = reassignmentChanges({ job, sourceEmployeeRecordId: sourceRecordId, sourceUserId, target: { employeeRecordId: target.employeeRecordId, userId: target.userId, date: dateIso } }) ?? {};
        const timeChanged = job.plannedTime !== time;
        if (!timeChanged && Object.keys(reassign).length === 0) return;
        const changes = { ...reassign, ...(timeChanged ? { plannedTime: time } : {}), ...(job.estimatedDurationMinutes == null ? { estimatedDurationMinutes: DEFAULT_VISIT_MINUTES } : {}) };
        const message = reassign.assignedUserIds !== undefined
          ? `Termin wurde zu ${name} auf ${time} Uhr verschoben.`
          : timeChanged ? `Termin wurde auf ${time} Uhr verschoben.` : moveSuccessMessage(reassign, name, dateLabel);
        void mutations.moveJob({ job, changes, successMessage: message, context: { name, date: dateLabel } });
        return;
      }
      case 'parked': {
        const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
        if (!context) { onParkedContextMissing(); return; }
        void mutations.unparkJob({
          job: payload.job,
          parkingContext: context,
          plannedDate: dateIso,
          plannedTime: time,
          ...(target.userId ? { assignToUserId: target.userId } : {}),
          durationMinutes: DEFAULT_VISIT_MINUTES,
          successMessage: `Auftrag wurde bei ${name} um ${time} Uhr eingeplant.`,
          context: { name, date: dateLabel },
        });
        return;
      }
      case 'resizeJob': {
        const { job, edge } = payload;
        const start = jobStartMinutes(job);
        const end = start + (job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES);
        const nextStart = edge === 'start' ? Math.min(minutes, end - MIN_ITEM_MINUTES) : start;
        const nextEnd = edge === 'end' ? Math.max(minutes, start + MIN_ITEM_MINUTES) : end;
        if (nextStart === start && nextEnd === end) return;
        void mutations.moveJob({
          job,
          changes: { ...(nextStart !== start ? { plannedTime: formatMinutesOfDay(nextStart) } : {}), estimatedDurationMinutes: nextEnd - nextStart },
          successMessage: `Termin dauert jetzt ${formatMinutesOfDay(nextStart)} bis ${formatMinutesOfDay(nextEnd)} Uhr.`,
          context: { name, date: dateLabel },
        });
        return;
      }
      case 'timeBlock': {
        const { session } = payload;
        if (!session.clockIn || !target.userId) return;
        const sourceEntries = session.sourceEntries ?? [session.clockIn, ...(session.clockOut ? [session.clockOut] : [])];
        const deltaMs = dayStart.getTime() + minutes * 60_000 - new Date(session.clockIn.timestamp).getTime();
        if (deltaMs === 0 && target.userId === payload.sourceUserId) return;
        void mutations.moveTimeBlock({
          sourceEntries,
          updates: shiftedBlockUpdates(sourceEntries, deltaMs, target.userId),
          successMessage: target.userId !== payload.sourceUserId ? `Arbeitszeit wurde zu ${name} verschoben.` : `Arbeitszeit wurde auf ${time} Uhr verschoben.`,
          context: { name, date: dateLabel },
        });
        return;
      }
      case 'resizeBlock': {
        const { session, edge } = payload;
        if (!session.clockIn) return;
        const sourceEntries = session.sourceEntries ?? [session.clockIn, ...(session.clockOut ? [session.clockOut] : [])];
        const clockInMs = new Date(session.clockIn.timestamp).getTime();
        const clockOutMs = session.clockOut ? new Date(session.clockOut.timestamp).getTime() : nowMs();
        const edgeMs = dayStart.getTime() + minutes * 60_000;
        const newTimestamp = new Date(edge === 'start' ? Math.min(edgeMs, clockOutMs - MIN_ITEM_MINUTES * 60_000) : Math.max(edgeMs, clockInMs + MIN_ITEM_MINUTES * 60_000)).toISOString();
        const updates = resizedBlockUpdates({ sourceEntries, clockInId: session.clockIn.id, clockOutId: session.clockOut?.id ?? null, edge, newTimestamp, userId: payload.sourceUserId })
          .filter((update) => sourceEntries.find((entry) => entry.id === update.entryId)?.timestamp !== update.newTimestamp);
        if (updates.length === 0) return;
        void mutations.resizeTimeBlock({ sourceEntries, updates, successMessage: 'Arbeitszeit wurde geändert.', context: { name, date: dateLabel } });
        return;
      }
      case 'barEdge':
        return;
      default: {
        const exhaustive: never = payload;
        return exhaustive;
      }
    }
  }, []);

  return useMemo<DragSurface>(() => ({
    prepare,
    resolveTarget,
    checkTarget,
    onTargetChange,
    onDrop,
    onEnd: () => { const highlight = inputRef.current.highlightRef.current; if (highlight) highlight.hidden = true; },
    scrollContainer: () => inputRef.current.horizontalScroller(),
  }), [checkTarget, onDrop, onTargetChange, prepare, resolveTarget]);
}
