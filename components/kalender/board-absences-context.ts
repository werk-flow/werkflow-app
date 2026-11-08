'use client';

import { createContext, useContext, useMemo } from 'react';
import { indexBoardAbsences, NO_BOARD_ABSENCES, type BoardAbsences } from '@/lib/calendar/absence-marks';
import type { CalendarBoardDay, CalendarBoardRow } from '@/lib/calendar/board';

/** The window's capacity days for the card's and the pickers' absence marks; empty outside the calendar. */
export const BoardAbsencesContext = createContext<BoardAbsences>(NO_BOARD_ABSENCES);

export function useBoardAbsences(): BoardAbsences {
  return useContext(BoardAbsencesContext);
}

/** The context value of the calendar's window, rebuilt only when its days or rows change. */
export function useIndexedBoardAbsences(
  days: readonly CalendarBoardDay[],
  rows: readonly CalendarBoardRow[],
): BoardAbsences {
  return useMemo(() => indexBoardAbsences(days, rows), [days, rows]);
}
