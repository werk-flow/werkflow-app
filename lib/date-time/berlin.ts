import type { DstResolution } from '@/lib/planning/types';

/**
 * The one home of the Europe/Berlin zone. Business dates, wall times and
 * clock labels are Berlin values wherever the code runs: the server (UTC on
 * Vercel) and every browser must agree. The German display formatters live in
 * lib/utils.ts and take the zone from here.
 */
export const BERLIN_TIME_ZONE = 'Europe/Berlin';

const MINUTE_MS = 60_000;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const berlinPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toInstant(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** The Berlin wall time of an instant as `YYYY-MM-DDTHH:MM`. Throws on an invalid instant. */
export function formatBerlinLocalDateTime(instant: Date | string): string {
  const date = toInstant(instant);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_instant');
  const parts = new Map(berlinPartsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}`;
}

/** The Berlin calendar date (`YYYY-MM-DD`) an instant falls on: its business date. */
export function formatBerlinLocalDate(instant: Date | string): string {
  return formatBerlinLocalDateTime(instant).slice(0, 10);
}

/** The value of a Berlin `datetime-local` input; an invalid value renders empty. */
export function formatBerlinDateTimeInput(value: string | Date): string {
  const date = toInstant(value);
  return Number.isNaN(date.getTime()) ? '' : formatBerlinLocalDateTime(date);
}

/** Today's Berlin business date. */
export function getBusinessTodayIso(): string {
  return formatBerlinLocalDate(new Date());
}

/** A `YYYY-MM-DDTHH:MM` wall time read as if it were UTC; null when it names no real date and time. */
function wallClockEpoch(localDateTime: string): number | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(localDateTime);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return null;
  const epoch = Date.UTC(year, month - 1, day, hour, minute);
  const candidate = new Date(epoch);
  const normalized =
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute;
  return normalized ? null : epoch;
}

// Europe/Berlin uses UTC+01:00 or UTC+02:00 for the supported modern dates.
function offsetCandidates(epoch: number): Date[] {
  return [60, 120].map((offsetMinutes) => new Date(epoch - offsetMinutes * MINUTE_MS));
}

/** The instants that render as this Berlin wall time, earliest first: none in the spring gap, two in the autumn overlap. */
function exactInstants(localDateTime: string, epoch: number): Date[] {
  return offsetCandidates(epoch)
    .filter((candidate) => formatBerlinLocalDateTime(candidate) === localDateTime)
    .sort((left, right) => left.getTime() - right.getTime());
}

export type ResolvedBerlinWallTime = {
  instant: Date;
  localDateTime: string;
  resolution: DstResolution;
};

/**
 * A planned Berlin wall time as an instant: the first occurrence of an
 * ambiguous autumn time; a nonexistent spring time shifted forward by the gap.
 */
export function resolveBerlinWallTime(localDateTime: string): ResolvedBerlinWallTime | null {
  const epoch = wallClockEpoch(localDateTime);
  if (epoch === null) return null;

  const candidates = exactInstants(localDateTime, epoch);
  const [firstCandidate] = candidates;
  if (firstCandidate) {
    return {
      instant: firstCandidate,
      localDateTime,
      resolution: candidates.length > 1 ? 'first_ambiguous' : 'exact',
    };
  }

  const shiftedCandidates = offsetCandidates(epoch)
    .map((instant) => ({ instant, rendered: formatBerlinLocalDateTime(instant) }))
    .filter((candidate) => candidate.rendered > localDateTime)
    .sort((left, right) => (left.rendered < right.rendered ? -1 : left.rendered > right.rendered ? 1 : 0));
  const shifted = shiftedCandidates[0];
  if (!shifted) return null;

  return {
    instant: shifted.instant,
    localDateTime: shifted.rendered,
    resolution: 'shifted_forward',
  };
}

/**
 * A typed Berlin `datetime-local` value as an instant. A nonexistent spring
 * time is no instant; an ambiguous autumn time is its standard-time (later)
 * occurrence.
 */
export function parseBerlinDateTimeInput(value: string): Date | null {
  const epoch = wallClockEpoch(value);
  if (epoch === null) return null;
  return exactInstants(value, epoch).at(-1) ?? null;
}

/**
 * A `YYYY-MM-DD` value with a month 01–12 and a day 01–31. A day past the
 * month's end rolls into the next month (31.04. is 01.05.), the way
 * `Date.parse` reads it; anything else is no date.
 */
function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_PATTERN.exec(localDate);
  const [year, month, day] = (match ?? []).slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error('invalid_local_date');
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error('invalid_local_date');
  return { year, month, day };
}

export function addLocalDays(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The same day `months` later; null when that month has no such day. */
export function addLocalMonths(localDate: string, months: number): string | null {
  const { year, month, day } = parseLocalDate(localDate);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (day > lastDay) return null;
  date.setUTCDate(day);
  return date.toISOString().slice(0, 10);
}

/** The same day `months` later, clamped to the last day of a shorter month. */
export function addLocalMonthsClamped(localDate: string, months: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const firstOfMonth = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfMonth.setUTCDate(Math.min(day, lastDay));
  return firstOfMonth.toISOString().slice(0, 10);
}

/** 0 for Monday through 6 for Sunday. */
export function getLocalWeekday(localDate: string): number {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new Error('invalid_local_date');
  }
  const sundayBased = date.getUTCDay();
  return sundayBased === 0 ? 6 : sundayBased - 1;
}

/** The Berlin midnight that starts a calendar date; midnight is never in a DST gap or overlap. */
function berlinMidnight(localDate: string): Date {
  const midnight = resolveBerlinWallTime(`${localDate}T00:00`);
  if (!midnight) throw new Error('invalid_berlin_midnight');
  return midnight.instant;
}

/** The first instant of the Berlin day an instant falls on. */
export function getLocalDayStart(date: Date): Date {
  return berlinMidnight(formatBerlinLocalDate(date));
}

/** The last millisecond of the Berlin day an instant falls on. */
export function getLocalDayEnd(date: Date): Date {
  return new Date(berlinMidnight(addLocalDays(formatBerlinLocalDate(date), 1)).getTime() - 1);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return formatBerlinLocalDate(a) === formatBerlinLocalDate(b);
}

/** Elapsed minutes of an interval per Berlin calendar date it touches. */
export function splitTimedIntervalByBerlinDate(
  startAt: Date,
  endAt: Date,
): Array<{ localDate: string; minutes: number }> {
  if (endAt.getTime() <= startAt.getTime()) return [];

  const allocations: Array<{ localDate: string; minutes: number }> = [];
  let cursor = new Date(startAt);
  while (cursor.getTime() < endAt.getTime()) {
    const localDate = formatBerlinLocalDate(cursor);
    const nextMidnight = berlinMidnight(addLocalDays(localDate, 1));
    const segmentEnd = new Date(Math.min(endAt.getTime(), nextMidnight.getTime()));
    if (segmentEnd.getTime() <= cursor.getTime()) {
      throw new Error('non_advancing_berlin_interval');
    }
    allocations.push({
      localDate,
      minutes: Math.round((segmentEnd.getTime() - cursor.getTime()) / MINUTE_MS),
    });
    cursor = segmentEnd;
  }
  return allocations;
}

/** Tomorrow's Berlin date at `hour`:00 as a `datetime-local` value: the default for a follow-up. */
export function tomorrowMorningInBerlin(now: Date = new Date(), hour = 9): string {
  return `${addLocalDays(formatBerlinLocalDate(now), 1)}T${String(hour).padStart(2, '0')}:00`;
}
