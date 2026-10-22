import {
  boardDayKey,
  dispatchStateFor,
  isStartedOccurrence,
  type CalendarBoardDay,
  type CalendarBoardRow,
} from '@/lib/calendar/board';
import type { BoardColumn } from '@/lib/calendar/board-layout';
import type { BoardRowModel } from '@/lib/calendar/board-model';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';
import { sameFields, sameItems, type MemoContentChecks } from '@/lib/ui/memo-equality';

/** What a Plantafel row shows from values the board rebuilds for every row on each change. */
export type BoardRowContent = {
  model: BoardRowModel;
  columns: readonly BoardColumn[];
  jobs: readonly CalendarJob[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  planned: ReadonlyMap<string, number>;
  actual: ReadonlyMap<string, { minutes: number; pending: boolean }> | null;
  dispatch: ReadonlyMap<string, DispatchRecipientDerivedState>;
  materialDemandJobIds: ReadonlySet<string>;
  nowMs: number;
  hoveredOccurrenceId: string | null;
};

/** Whether the row shows the same value under each of its columns' keys; the unassigned row shows none. */
function sameColumnValues(
  next: BoardRowContent,
  keyOf: (row: CalendarBoardRow, date: string) => string | null,
  same: (key: string) => boolean,
): boolean {
  const row = next.model.row;
  if (!row) return true;
  return next.columns.every((column) => {
    const key = keyOf(row, column.date);
    return key === null || same(key);
  });
}

function dayKey(row: CalendarBoardRow, date: string): string {
  return boardDayKey(row.employeeRecordId, date);
}

function actualKey(row: CalendarBoardRow, date: string): string | null {
  return row.userId ? `${row.userId}:${date}` : null;
}

function isHovered(job: CalendarJob, hoveredOccurrenceId: string | null): boolean {
  return hoveredOccurrenceId !== null && job.occurrenceId === hoveredOccurrenceId;
}

/**
 * The content checks of a Plantafel row (lib/ui/memo-equality.ts). The
 * board rebuilds its row models, row lists and whole-board indexes whenever
 * one card moves or one read lands, and it hovers one card at a time; each
 * check compares only what this row shows from them: its person, its cards,
 * its person-days and, per card, the dispatch state, the material flag, the
 * started lock and the hover link. Every other prop counts by identity.
 */
export const BOARD_ROW_CONTENT_CHECKS = {
  model: (previous, next) =>
    previous.model.key === next.model.key &&
    previous.model.kind === next.model.kind &&
    previous.model.row === next.model.row,
  jobs: (previous, next) => sameItems(previous.jobs, next.jobs),
  days: (previous, next) =>
    sameColumnValues(next, dayKey, (key) => previous.days.get(key) === next.days.get(key)),
  planned: (previous, next) =>
    sameColumnValues(next, dayKey, (key) => previous.planned.get(key) === next.planned.get(key)),
  actual: (previous, next) =>
    sameColumnValues(next, actualKey, (key) => sameFields(previous.actual?.get(key), next.actual?.get(key))),
  dispatch: (previous, next) => {
    const recordId = next.model.row?.employeeRecordId ?? null;
    return next.jobs.every(
      (job) =>
        dispatchStateFor(previous.dispatch, job.occurrenceId, recordId) ===
        dispatchStateFor(next.dispatch, job.occurrenceId, recordId),
    );
  },
  materialDemandJobIds: (previous, next) =>
    next.jobs.every(
      (job) =>
        previous.materialDemandJobIds.has(job.jobId ?? '') === next.materialDemandJobIds.has(job.jobId ?? ''),
    ),
  nowMs: (previous, next) =>
    next.jobs.every(
      (job) => isStartedOccurrence(job, previous.nowMs) === isStartedOccurrence(job, next.nowMs),
    ),
  hoveredOccurrenceId: (previous, next) =>
    next.jobs.every(
      (job) => isHovered(job, previous.hoveredOccurrenceId) === isHovered(job, next.hoveredOccurrenceId),
    ),
} satisfies MemoContentChecks<BoardRowContent>;
