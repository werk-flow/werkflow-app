/**
 * Builds a local-midnight date from typed day/month/year segments. The day is
 * clamped to the month's last day; any segment below 1 yields no date.
 * `setFullYear` keeps years below 100 literal instead of mapping them to 19xx.
 */
export function buildDateFromSegments(day: number, month: number, year: number): Date | undefined {
  if (day < 1 || month < 1 || year < 1) return undefined;
  const endOfMonth = new Date(0);
  endOfMonth.setFullYear(year, month, 0);
  const maxDay = endOfMonth.getDate();
  const clampedDay = Math.min(day, maxDay);
  const result = new Date(0);
  result.setFullYear(year, month - 1, clampedDay);
  result.setHours(0, 0, 0, 0);
  return result;
}
