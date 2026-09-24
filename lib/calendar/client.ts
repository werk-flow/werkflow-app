import type { CalendarWindowInput, CalendarWindowResult } from './actions';
import type { CalendarBoardInput, CalendarBoardResult } from './board-actions';
import { calendarBoardResponseSchema, calendarWindowResponseSchema } from './window-response';

/** Fetch starts immediately, independently of the browser's serialized Server Action queue. */
export async function getCalendarWindow(input: CalendarWindowInput): Promise<CalendarWindowResult> {
  try {
    const query = new URLSearchParams(input);
    const response = await fetch(`/api/calendar-window?${query}`, { cache: 'no-store', credentials: 'same-origin' });
    const parsed = calendarWindowResponseSchema.safeParse(await response.json());
    if (!parsed.success || (!response.ok && parsed.data.success)) return { success: false, error: 'calendar_read_failed' };
    return parsed.data;
  } catch {
    return { success: false, error: 'calendar_read_failed' };
  }
}

/** The board context for the same window, over the same private transport (P1-24a). */
export async function getCalendarBoard(input: CalendarBoardInput): Promise<CalendarBoardResult> {
  try {
    const query = new URLSearchParams(input);
    const response = await fetch(`/api/calendar-board?${query}`, { cache: 'no-store', credentials: 'same-origin' });
    const parsed = calendarBoardResponseSchema.safeParse(await response.json());
    if (!parsed.success || (!response.ok && parsed.data.success)) return { success: false, error: 'calendar_read_failed' };
    return parsed.data;
  } catch {
    return { success: false, error: 'calendar_read_failed' };
  }
}
