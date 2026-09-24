import { addLocalDays, getLocalWeekday } from '@/lib/planning/date-time';

/**
 * Pure layout of the Plantafel (P1-24a): the visible day columns of a
 * horizon and the lane packing that places cards and bars inside a person's
 * row. The board renders one CSS grid per row from this output, so a row's
 * height follows its content and a multi-day bar is one element.
 */

export type BoardColumn = {
  /** Berlin date, YYYY-MM-DD. */
  date: string;
  /** 0 = Montag … 6 = Sonntag. */
  weekday: number;
  isWeekend: boolean;
  isToday: boolean;
};

export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export function mondayOf(dateIso: string): string {
  return addLocalDays(dateIso, -getLocalWeekday(dateIso));
}

/** The Monday-started columns of `horizonWeeks` weeks around `anchorIso`. */
export function boardColumns(input: {
  anchorIso: string;
  horizonWeeks: number;
  hideWeekends: boolean;
  todayIso: string;
}): BoardColumn[] {
  const columns: BoardColumn[] = [];
  const start = mondayOf(input.anchorIso);
  for (let index = 0; index < input.horizonWeeks * 7; index += 1) {
    const date = addLocalDays(start, index);
    const weekday = index % 7;
    const isWeekend = weekday >= 5;
    if (isWeekend && input.hideWeekends) continue;
    columns.push({ date, weekday, isWeekend, isToday: date === input.todayIso });
  }
  return columns;
}

/** First and last date of a horizon, weekends included, for the window read. */
export function boardDateRange(anchorIso: string, horizonWeeks: number): { from: string; to: string } {
  const from = mondayOf(anchorIso);
  return { from, to: addLocalDays(from, horizonWeeks * 7 - 1) };
}

export type BoardSpanItem = {
  key: string;
  startDate: string;
  /** Exclusive end date. */
  endDateExclusive: string;
  /** Orders items that start in the same column: minutes of the day, or a stable rank. */
  sortMinutes: number;
};

export type BoardLaneItem<Item extends BoardSpanItem> = {
  item: Item;
  /** 0-based lane inside the row. */
  lane: number;
  /** 0-based first visible column. */
  column: number;
  /** Visible columns covered, at least 1. */
  span: number;
};

/**
 * Greedy lane packing over visible columns: an item takes the first lane
 * whose columns are free over its span. Longer items pack first so bars stay
 * high in the row; ties keep the day order. Items entirely outside the
 * visible columns are dropped; partly visible ones are clipped.
 */
export function packLanes<Item extends BoardSpanItem>(
  items: readonly Item[],
  columns: readonly BoardColumn[],
): { lanes: BoardLaneItem<Item>[]; laneCount: number } {
  const columnIndex = new Map(columns.map((column, index) => [column.date, index]));
  const placed: Array<{ item: Item; column: number; span: number }> = [];
  for (const item of items) {
    let first: number | null = null;
    let last: number | null = null;
    for (let date = item.startDate; date < item.endDateExclusive; date = addLocalDays(date, 1)) {
      const index = columnIndex.get(date);
      if (index === undefined) continue;
      if (first === null) first = index;
      last = index;
    }
    if (first === null || last === null) continue;
    placed.push({ item, column: first, span: last - first + 1 });
  }
  placed.sort((left, right) => {
    if (left.column !== right.column) return left.column - right.column;
    if (left.span !== right.span) return right.span - left.span;
    if (left.item.sortMinutes !== right.item.sortMinutes) return left.item.sortMinutes - right.item.sortMinutes;
    return left.item.key.localeCompare(right.item.key);
  });
  const occupancy: boolean[][] = [];
  const lanes: BoardLaneItem<Item>[] = [];
  for (const entry of placed) {
    let lane = 0;
    for (;;) {
      const row = occupancy[lane] ?? (occupancy[lane] = []);
      let free = true;
      for (let column = entry.column; column < entry.column + entry.span; column += 1) {
        if (row[column]) { free = false; break; }
      }
      if (free) {
        for (let column = entry.column; column < entry.column + entry.span; column += 1) row[column] = true;
        break;
      }
      lane += 1;
    }
    lanes.push({ item: entry.item, lane, column: entry.column, span: entry.span });
  }
  return { lanes, laneCount: occupancy.length };
}

/** Where a bar segment sits inside its span, for joined edges. */
export type BarEdge = 'single' | 'start' | 'middle' | 'end';

export function barEdge(index: number, count: number): BarEdge {
  if (count <= 1) return 'single';
  if (index === 0) return 'start';
  if (index === count - 1) return 'end';
  return 'middle';
}

/** Minutes of the day of a Berlin wall-clock string („09:30" → 570). */
export function minutesOfDay(time: string | null | undefined): number {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}
