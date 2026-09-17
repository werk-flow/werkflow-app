import { resolveBerlinWallTime } from "@/lib/planning/date-time";
import { shiftIsoDateByDays } from "@/lib/personnel/types";
import type { CalendarFetchRange } from "./navigation";

/**
 * The calendar's day window for one Berlin business date, as instants: the
 * previous day's first millisecond through the business day's last
 * millisecond. Matches `getCalendarFetchRange(date, "day")` for a browser in
 * Europe/Berlin, so a server prefetch can seed the client's coverage (PF-17).
 */
export function getBerlinDayFetchRange(businessDate: string): CalendarFetchRange {
  const start = resolveBerlinWallTime(`${shiftIsoDateByDays(businessDate, -1)}T00:00`);
  const nextDay = resolveBerlinWallTime(`${shiftIsoDateByDays(businessDate, 1)}T00:00`);
  if (!start || !nextDay) throw new Error(`Invalid business date: ${businessDate}`);
  return {
    start: start.instant,
    end: new Date(nextDay.instant.getTime() - 1),
  };
}
