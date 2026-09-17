import type { CalendarWindowInput, CalendarWindowResult } from './actions';
import { calendarWindowResponseSchema } from './window-response';

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
