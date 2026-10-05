import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';

/**
 * Boundary parser for calendar date windows that reach server actions as
 * plain ISO dates. The maximum span keeps a client from turning a bounded
 * absence or planning read into a whole-history export.
 */
export type IsoDateRange = { from: string; to: string };

const MAX_CALENDAR_RANGE_DAYS = 400;

/** Strict YYYY-MM-DD validation without JavaScript's rollover behavior. */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

/** The absence window a calendar read uses when the caller names none: one year back, two ahead. */
export function defaultCalendarWindow(): IsoDateRange {
  const businessDate = getBusinessTodayIso();
  return {
    from: shiftIsoDateByDays(businessDate, -365),
    to: shiftIsoDateByDays(businessDate, 730),
  };
}

export function parseIsoDateRange(input: unknown): IsoDateRange | null {
  if (!input || typeof input !== 'object') return null;
  if (!('from' in input) || !('to' in input)) return null;
  const { from, to } = input;
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) return null;
  const spanDays = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_CALENDAR_RANGE_DAYS) return null;
  return { from, to };
}

/** Optional bookmark date; invalid or repeated query parameters use today's date. */
export function calendarDateFromQuery(value: string | string[] | undefined, today: string): string {
  return typeof value === 'string' && isValidIsoDate(value) ? value : today;
}
