'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MonthCell } from '@/lib/calendar/month-layout';

/** A day of the grid with its place in the keyboard path. */
export type MonthGridCell = MonthCell & { tabStop: boolean };

/** How far an arrow key moves in the shown days: one day sideways, one week up or down. */
const ARROW_STEPS: ReadonlyMap<string, number> = new Map([
  ['ArrowLeft', -1],
  ['ArrowRight', 1],
  ['ArrowUp', -7],
  ['ArrowDown', 7],
]);

type MonthKeyboard = {
  weeks: MonthGridCell[][];
  onFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * The month grid's keyboard path (APG grid with a roving tab stop): one day
 * cell is in the tab order, the last focused day, else today in the shown
 * month, else its first day. Arrow keys move between the shown days and stop
 * at the grid's edge; Enter and Space open the day like a click on its number.
 */
export function useMonthKeyboard({
  weeks,
  rootRef,
  onOpenDay,
}: {
  weeks: MonthCell[][];
  rootRef: React.RefObject<HTMLDivElement | null>;
  onOpenDay: (date: Date) => void;
}): MonthKeyboard {
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const days = useMemo(() => weeks.flat(), [weeks]);
  const tabStopDate =
    days.find((cell) => cell.date === focusedDate)?.date ??
    days.find((cell) => cell.isToday && cell.inMonth)?.date ??
    days.find((cell) => cell.inMonth)?.date;
  const gridWeeks = useMemo(
    () => weeks.map((week) => week.map((cell) => ({ ...cell, tabStop: cell.date === tabStopDate }))),
    [tabStopDate, weeks],
  );

  const onFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const date = event.target instanceof HTMLElement ? event.target.dataset.monthCell : undefined;
    if (date !== undefined) setFocusedDate(date);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const fromDate = event.target instanceof HTMLElement ? event.target.dataset.monthCell : undefined;
      if (fromDate === undefined) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenDay(new Date(`${fromDate}T12:00:00`));
        return;
      }
      const step = ARROW_STEPS.get(event.key);
      if (step === undefined) return;
      const toDate = days[days.findIndex((cell) => cell.date === fromDate) + step]?.date;
      if (toDate === undefined) return;
      const target = rootRef.current?.querySelector<HTMLElement>(`[data-month-cell="${toDate}"]`);
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [days, onOpenDay, rootRef],
  );

  return { weeks: gridWeeks, onFocus, onKeyDown };
}
