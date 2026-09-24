import { addLocalDays } from '@/lib/planning/date-time';
import { mondayOf } from './board-layout';

/**
 * Pure geometry of the month view (P1-24a, package D): the weeks a month
 * spans, Monday to Sunday, and how many items a cell shows before „+n mehr".
 */
export const MONTH_MAX_VISIBLE_ITEMS = 3;

/**
 * The grid rows of one week: the date header, one lane per bar, the items
 * row. Built without `repeat()` because `repeat(0, …)` is invalid CSS and
 * makes the browser drop the whole template, which misplaces every cell.
 */
export function monthRowTemplate(laneCount: number): string {
  return ['auto', ...Array.from({ length: Math.max(0, laneCount) }, () => 'minmax(22px, auto)'), 'minmax(64px, auto)'].join(' ');
}

export type MonthCell = { date: string; weekday: number; isToday: boolean; inMonth: boolean; isPast: boolean; isWeekend: boolean };

/** The weeks that cover the month of `anchorIso`, each seven cells from Monday. */
export function monthWeeks(anchorIso: string, todayIso: string): MonthCell[][] {
  const month = anchorIso.slice(0, 7);
  const firstOfMonth = `${month}-01`;
  const weeks: MonthCell[][] = [];
  let cursor = mondayOf(firstOfMonth);
  do {
    const week: MonthCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      week.push({ date: cursor, weekday, isToday: cursor === todayIso, inMonth: cursor.slice(0, 7) === month, isPast: cursor < todayIso, isWeekend: weekday >= 5 });
      cursor = addLocalDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.slice(0, 7) === month);
  return weeks;
}

/** The first and last date the grid shows, for filtering items. */
export function monthGridRange(weeks: MonthCell[][]): { from: string; to: string } {
  const first = weeks[0]?.[0]?.date ?? '';
  const last = weeks.at(-1)?.[6]?.date ?? '';
  return { from: first, to: last };
}
