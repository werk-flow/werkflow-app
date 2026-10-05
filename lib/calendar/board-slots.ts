import { indexAtOffset } from './drag-math';
import type { BoardRowModel } from './board-model';
import { addLocalDays } from '@/lib/planning/date-time';

/**
 * Pure geometry of the Plantafel's drag surface (P1-24a): the slot under a
 * pointer, the highlight rectangle of a slot, the row that owns a target,
 * and the span a dragged bar edge produces. The hook measures the DOM once
 * per drag; everything after that measurement is computed here.
 */

type BoardSlotStarts = {
  /** Viewport offsets of every row start plus the last row's bottom. */
  rowStarts: readonly number[];
  /** Viewport offsets of every column start plus the last column's right edge. */
  columnStarts: readonly number[];
};

type BoardSlotIndex = { rowIndex: number; columnIndex: number };

/** The row and column under a viewport point, after the scroll that happened since the measurement. */
export function boardSlotAtPoint(
  input: BoardSlotStarts & {
    point: { x: number; y: number };
    scrollDelta: { x: number; y: number };
  },
): BoardSlotIndex | null {
  const rowIndex = indexAtOffset(input.rowStarts, input.point.y + input.scrollDelta.y);
  const columnIndex = indexAtOffset(input.columnStarts, input.point.x + input.scrollDelta.x);
  if (rowIndex === null || columnIndex === null) return null;
  return { rowIndex, columnIndex };
}

/** The highlight rectangle of one slot in the board root's content space, rounded to whole pixels. */
export function boardSlotRect(
  input: BoardSlotStarts &
    BoardSlotIndex & {
      contentTop: number;
      contentLeft: number;
    },
): { left: number; top: number; width: number; height: number } {
  const top = (input.rowStarts[input.rowIndex] ?? 0) - input.contentTop;
  const bottom = (input.rowStarts[input.rowIndex + 1] ?? 0) - input.contentTop;
  const left = (input.columnStarts[input.columnIndex] ?? 0) - input.contentLeft;
  const right = (input.columnStarts[input.columnIndex + 1] ?? 0) - input.contentLeft;
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/** The employee record a board row stands for; the „Ohne Zuweisung" row stands for none. */
export function boardRowRecordId(model: BoardRowModel): string | null {
  return model.kind === 'person' ? model.row.employeeRecordId : null;
}

/** The row model a drop target names, or null when the row is no longer on the board. */
export function findBoardRowModel(
  rowModels: readonly BoardRowModel[],
  employeeRecordId: string | null,
): BoardRowModel | null {
  return rowModels.find((model) => boardRowRecordId(model) === employeeRecordId) ?? null;
}

/**
 * The new span of an all-day bar whose start or end edge was dropped on a
 * date. Null when the bar has no span, the edge would invert the span, or
 * nothing changes.
 */
export function resizedBarSpan(input: {
  startDate: string | null;
  endDateExclusive: string | null | undefined;
  edge: 'start' | 'end';
  targetDate: string;
}): { plannedDate: string; durationDays: number; endDateExclusive: string } | null {
  const { startDate, edge, targetDate } = input;
  const endDateExclusive = input.endDateExclusive ?? (startDate ? addLocalDays(startDate, 1) : null);
  if (!startDate || !endDateExclusive) return null;
  const nextStart = edge === 'start' ? (targetDate < endDateExclusive ? targetDate : startDate) : startDate;
  const nextEndExclusive =
    edge === 'end'
      ? targetDate >= nextStart
        ? addLocalDays(targetDate, 1)
        : endDateExclusive
      : endDateExclusive;
  const durationDays = Math.round(
    (Date.parse(`${nextEndExclusive}T00:00:00Z`) - Date.parse(`${nextStart}T00:00:00Z`)) / 86_400_000,
  );
  if (durationDays < 1 || (nextStart === startDate && nextEndExclusive === endDateExclusive)) return null;
  return { plannedDate: nextStart, durationDays, endDateExclusive: nextEndExclusive };
}
