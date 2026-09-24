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

/**
 * The board's window for one Berlin business date: the day before the
 * Monday of that week through the last millisecond of the day after the
 * horizon. Matches `getCalendarFetchRange(date, "week", horizonWeeks)` for a
 * browser in Europe/Berlin, so the landing prefetch (P1-24a, D1) seeds the
 * client's coverage the way the day window does.
 */
export function getBerlinWeekFetchRange(businessDate: string, horizonWeeks: number): CalendarFetchRange & { fromIso: string; toIso: string } {
  const daysSinceMonday = (new Date(`${businessDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftIsoDateByDays(businessDate, -daysSinceMonday);
  const fromIso = shiftIsoDateByDays(monday, -1);
  const toIso = shiftIsoDateByDays(monday, 7 * horizonWeeks);
  const start = resolveBerlinWallTime(`${fromIso}T00:00`);
  const afterEnd = resolveBerlinWallTime(`${shiftIsoDateByDays(toIso, 1)}T00:00`);
  if (!start || !afterEnd) throw new Error(`Invalid business date: ${businessDate}`);
  return { start: start.instant, end: new Date(afterEnd.instant.getTime() - 1), fromIso, toIso };
}
