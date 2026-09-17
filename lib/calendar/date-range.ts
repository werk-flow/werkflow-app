/**
 * Boundary parser for calendar date windows that reach server actions as
 * plain ISO dates. The maximum span keeps a client from turning a bounded
 * absence or planning read into a whole-history export (PF-05).
 */
export type IsoDateRange = { from: string; to: string };

const MAX_CALENDAR_RANGE_DAYS = 400;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseIsoDateRange(input: unknown): IsoDateRange | null {
  if (!input || typeof input !== "object") return null;
  if (!("from" in input) || !("to" in input)) return null;
  const { from, to } = input;
  if (typeof from !== "string" || typeof to !== "string") return null;
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to) return null;
  const spanDays =
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_CALENDAR_RANGE_DAYS) return null;
  return { from, to };
}

/** Optional bookmark date; invalid or repeated query parameters use today's date. */
export function calendarDateFromQuery(value: string | string[] | undefined, today: string): string {
  return typeof value === 'string' && isRealIsoDate(value) ? value : today;
}
