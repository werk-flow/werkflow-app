import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const germanDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const germanDateTime = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const berlinDateTime = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});
const germanMediumDateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const berlinTime = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
});

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

type MissingDatePlaceholder = { empty: string };

/** 13.09.2026; with `{ empty }`, a missing value renders that placeholder instead. */
export function formatGermanDate(value: string | Date): string;
export function formatGermanDate(
  value: string | Date | null | undefined,
  options: MissingDatePlaceholder,
): string;
export function formatGermanDate(
  value: string | Date | null | undefined,
  options?: MissingDatePlaceholder,
): string {
  if (!value) return options?.empty ?? '';
  // A calendar date needs no time zone at all: format its digits directly.
  const calendarDate = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (calendarDate) return `${calendarDate[3]}.${calendarDate[2]}.${calendarDate[1]}`;
  return germanDate.format(toCalendarAwareDate(value));
}

/** 13.09.2026 for a single day, 13.09.2026 – 15.09.2026 for several. */
export function formatGermanDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatGermanDate(startDate);
  return `${formatGermanDate(startDate)} – ${formatGermanDate(endDate)}`;
}

/** 13.09.2026, 08:15 */
export function formatGermanDateTime(value: string | Date): string {
  return germanDateTime.format(toCalendarAwareDate(value));
}

/** 13.09.2026, 08:15 in Europe/Berlin, independent of the browser's time zone. */
export function formatBerlinDateTime(value: string | Date): string {
  return berlinDateTime.format(new Date(value));
}

/** 08:15 in Europe/Berlin, independent of the browser's and the server's time zone. */
export function formatBerlinTime(value: string | Date): string {
  return berlinTime.format(new Date(value));
}

/** 13. Sept. 2026, 08:15 in the browser's time zone. */
export function formatGermanMediumDateTime(value: string | Date): string {
  return germanMediumDateTime.format(new Date(value));
}

/**
 * The inverse of toLocalDateString: a `YYYY-MM-DD` string as local midnight
 * for a date picker. Anything without a non-zero year, month and day is no date.
 */
export function parseIsoLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
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

/** The Date's local wall clock as `HH:MM`, the value of a time input; the time counterpart of toLocalDateString. */
export function toLocalTimeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
