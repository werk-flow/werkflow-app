import type { DstResolution } from './types';

const BERLIN_TIME_ZONE = 'Europe/Berlin';
const MINUTE_MS = 60_000;

const berlinFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type ResolvedBerlinWallTime = {
  instant: Date;
  localDateTime: string;
  resolution: DstResolution;
};

function parseLocalDateTime(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  const candidate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  if (
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() !== parts.month - 1 ||
    candidate.getUTCDate() !== parts.day ||
    candidate.getUTCHours() !== parts.hour ||
    candidate.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }
  return parts;
}

export function formatBerlinLocalDateTime(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error('invalid_instant');

  const values = Object.fromEntries(
    berlinFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function formatBerlinLocalDate(instant: Date | string): string {
  return formatBerlinLocalDateTime(instant).slice(0, 10);
}

export function resolveBerlinWallTime(
  localDateTime: string
): ResolvedBerlinWallTime | null {
  const parts = parseLocalDateTime(localDateTime);
  if (!parts) return null;

  const wallClockEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  // Europe/Berlin uses UTC+01:00 or UTC+02:00 for the supported modern dates.
  const candidates = [60, 120]
    .map((offsetMinutes) => new Date(wallClockEpoch - offsetMinutes * MINUTE_MS))
    .filter(
      (candidate) => formatBerlinLocalDateTime(candidate) === localDateTime
    )
    .sort((left, right) => left.getTime() - right.getTime());

  if (candidates.length > 0) {
    return {
      instant: candidates[0],
      localDateTime,
      resolution: candidates.length > 1 ? 'first_ambiguous' : 'exact',
    };
  }

  const shiftedCandidates = [60, 120]
    .map((offsetMinutes) => new Date(wallClockEpoch - offsetMinutes * MINUTE_MS))
    .map((instant) => ({
      instant,
      rendered: formatBerlinLocalDateTime(instant),
    }))
    .filter((candidate) => candidate.rendered > localDateTime)
    .sort((left, right) =>
      left.rendered < right.rendered
        ? -1
        : left.rendered > right.rendered
          ? 1
          : 0
    );
  const shifted = shiftedCandidates[0];
  if (!shifted) return null;

  return {
    instant: shifted.instant,
    localDateTime: shifted.rendered,
    resolution: 'shifted_forward',
  };
}

export function addLocalDays(localDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error('invalid_local_date');
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addLocalMonths(localDate: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error('invalid_local_date');
  const day = Number(match[3]);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  if (day > lastDay) return null;
  date.setUTCDate(day);
  return date.toISOString().slice(0, 10);
}

export function addLocalMonthsClamped(localDate: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error('invalid_local_date');
  const requestedDay = Number(match[3]);
  const firstOfMonth = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1)
  );
  const lastDay = new Date(
    Date.UTC(
      firstOfMonth.getUTCFullYear(),
      firstOfMonth.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  firstOfMonth.setUTCDate(Math.min(requestedDay, lastDay));
  return firstOfMonth.toISOString().slice(0, 10);
}

export function getLocalWeekday(localDate: string): number {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new Error('invalid_local_date');
  }
  const sundayBased = date.getUTCDay();
  return sundayBased === 0 ? 6 : sundayBased - 1;
}

export function splitTimedIntervalByBerlinDate(
  startAt: Date,
  endAt: Date
): Array<{ localDate: string; minutes: number }> {
  if (endAt.getTime() <= startAt.getTime()) return [];

  const allocations: Array<{ localDate: string; minutes: number }> = [];
  let cursor = new Date(startAt);
  while (cursor.getTime() < endAt.getTime()) {
    const localDate = formatBerlinLocalDate(cursor);
    const nextLocalDate = addLocalDays(localDate, 1);
    const nextMidnight = resolveBerlinWallTime(`${nextLocalDate}T00:00`);
    if (!nextMidnight) throw new Error('invalid_berlin_midnight');
    const segmentEnd = new Date(
      Math.min(endAt.getTime(), nextMidnight.instant.getTime())
    );
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

export function localDateTimeFromDateAndTime(
  localDate: string,
  localTime: string
): string {
  return `${localDate}T${localTime.slice(0, 5)}`;
}
