import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const germanDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const germanDateTime = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const berlinDateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });

/**
 * A date-only ISO string is a calendar date, not an instant: `new Date('2026-09-13')`
 * is UTC midnight and renders as 12.09. west of Greenwich. Timestamps and Date values
 * keep their instant.
 */
function toCalendarAwareDate(value: string | Date): Date {
  const calendarDate = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return calendarDate
    ? new Date(Number(calendarDate[1]), Number(calendarDate[2]) - 1, Number(calendarDate[3]))
    : new Date(value);
}

/** 13.09.2026 */
export function formatGermanDate(value: string | Date): string {
  return germanDate.format(toCalendarAwareDate(value));
}

/** 13.09.2026, 08:15 */
export function formatGermanDateTime(value: string | Date): string {
  return germanDateTime.format(toCalendarAwareDate(value));
}

/** 13.09.2026, 08:15 in Europe/Berlin, independent of the browser's time zone. */
export function formatBerlinDateTime(value: string | Date): string {
  return berlinDateTime.format(new Date(value));
}

export function toLocalDateString(date: Date): string {
  // Pad the year too: intermediate DatePicker states can hold years like 202,
  // and an unpadded "202-01-01" is not parseable ISO ("Invalid Date"), which
  // wedges string-state date round trips at NaN.
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
