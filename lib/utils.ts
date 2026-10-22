import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { BERLIN_TIME_ZONE } from '@/lib/date-time/berlin';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * The German label styles on the Berlin calendar and wall clock, each with
 * the text it renders for 3 September 2026, 10:15 Berlin time.
 */
const BERLIN_LABEL_STYLES = {
  /** 3.9.2026 */
  numericDate: {},
  /** 03.09.2026 */
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  /** 03.09.26 */
  shortYearDate: { day: '2-digit', month: '2-digit', year: '2-digit' },
  /** 3.9.26 */
  compactDate: { day: 'numeric', month: 'numeric', year: '2-digit' },
  /** 3. September 2026 */
  longDate: { dateStyle: 'long' },
  /** Do., 03.09. */
  weekdayDayMonth: { weekday: 'short', day: '2-digit', month: '2-digit' },
  /** Do., 03.09.2026 */
  weekdayDate: { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' },
  /** Donnerstag, 03.09.2026 */
  longWeekdayDate: { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' },
  /** September 2026 */
  monthYear: { month: 'long', year: 'numeric' },
  /** Sept. 2026 */
  shortMonthYear: { month: 'short', year: 'numeric' },
  /** Sept. */
  shortMonth: { month: 'short' },
  /** 10:15 */
  time: { hour: '2-digit', minute: '2-digit' },
  /** 03.09., 10:15 */
  dayMonthTime: { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
  /** 03.09.26, 10:15 */
  shortDateTime: { dateStyle: 'short', timeStyle: 'short' },
  /** 03.09.2026, 10:15 */
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  /** Do., 03.09.2026, 10:15 */
  weekdayDateTime: {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  /** Donnerstag, 03.09.2026, 10:15 */
  longWeekdayDateTime: {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type BerlinLabelStyle = keyof typeof BERLIN_LABEL_STYLES;

// Built on first use: lib/utils loads on every page, most styles render on few.
const berlinLabelFormatters = new Map<BerlinLabelStyle, Intl.DateTimeFormat>();

/**
 * A German label for a date or an instant on the Berlin calendar and wall
 * clock, the same on the server (UTC) and in every browser. A timestamp or a
 * Date is an instant. A `YYYY-MM-DD` calendar date parses as UTC midnight,
 * which always falls on that same Berlin day. A Date that stands for a local
 * calendar day (a picker value, a calendar view day) goes through
 * formatLocalCalendarDay instead.
 */
export function formatBerlin(value: string | Date, style: BerlinLabelStyle): string {
  let formatter = berlinLabelFormatters.get(style);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('de-DE', {
      ...BERLIN_LABEL_STYLES[style],
      timeZone: BERLIN_TIME_ZONE,
    });
    berlinLabelFormatters.set(style, formatter);
  }
  return formatter.format(new Date(value));
}

/** A Date that stands for a day of the viewer's local calendar, labeled as that day. */
export function formatLocalCalendarDay(date: Date, style: BerlinLabelStyle): string {
  return formatBerlin(toLocalDateString(date), style);
}

type MissingDatePlaceholder = { empty: string };

/**
 * 13.09.2026 on the Berlin calendar, on the server (UTC) and in every browser;
 * with `{ empty }`, a missing value renders that placeholder instead. A
 * `YYYY-MM-DD` calendar date keeps its digits, and a timestamp shows its
 * Berlin day. A Date for a local calendar day goes through formatLocalCalendarDay.
 */
export function formatGermanDate(value: string): string;
export function formatGermanDate(value: string | null | undefined, options: MissingDatePlaceholder): string;
export function formatGermanDate(value: string | null | undefined, options?: MissingDatePlaceholder): string {
  if (!value) return options?.empty ?? '';
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) return `${calendarDate[3]}.${calendarDate[2]}.${calendarDate[1]}`;
  return formatBerlin(value, 'date');
}

/** 13.09.2026 for a single day, 13.09.2026 – 15.09.2026 for several. */
export function formatGermanDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatGermanDate(startDate);
  return `${formatGermanDate(startDate)} – ${formatGermanDate(endDate)}`;
}

/** 13.09.2026, 08:15 in Europe/Berlin, independent of the browser's time zone. */
export function formatBerlinDateTime(value: string | Date): string {
  return formatBerlin(value, 'dateTime');
}

/** 08:15 in Europe/Berlin, independent of the browser's and the server's time zone. */
export function formatBerlinTime(value: string | Date): string {
  return formatBerlin(value, 'time');
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
