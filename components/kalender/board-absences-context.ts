'use client';

import { createContext, useContext, useMemo } from 'react';
import { indexBoardAbsences, NO_BOARD_ABSENCES, type BoardAbsences } from '@/lib/calendar/absence-marks';
import type { CalendarBoardContext } from '@/lib/calendar/board';

/** The window's capacity days for the card's and the pickers' absence marks; empty outside the calendar. */
export const BoardAbsencesContext = createContext<BoardAbsences>(NO_BOARD_ABSENCES);

export function useBoardAbsences(): BoardAbsences {
  return useContext(BoardAbsencesContext);
}

/** The context value of the calendar's window, rebuilt only when its days or people change. */
export function useIndexedBoardAbsences({
  days,
  rows,
  rowlessAssignees,
}: Pick<CalendarBoardContext, 'days' | 'rows' | 'rowlessAssignees'>): BoardAbsences {
  return useMemo(() => indexBoardAbsences(days, rows, rowlessAssignees), [days, rows, rowlessAssignees]);
}
