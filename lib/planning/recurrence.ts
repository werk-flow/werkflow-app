import {
  addLocalDays,
  addLocalMonths,
  getLocalWeekday,
  resolveBerlinWallTime,
} from './date-time';
import type {
  MaterializedOccurrence,
  PlanningSeriesDraft,
} from './types';

const MAX_OCCURRENCES = 730;
const MAX_MONTH_OFFSET = 1200;

function getCandidateDates(
  draft: PlanningSeriesDraft,
  horizonLocalDate: string
): string[] {
  if (!Number.isInteger(draft.interval) || draft.interval < 1) {
    throw new Error('invalid_recurrence_interval');
  }
  const startDate = draft.startsAtLocal.slice(0, 10);
  const endDate = draft.untilLocalDate
    ? draft.untilLocalDate < horizonLocalDate
      ? draft.untilLocalDate
      : horizonLocalDate
    : horizonLocalDate;
  const limit = Math.min(draft.occurrenceCount ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const dates: string[] = [];

  if (draft.frequency === 'daily') {
    for (let date = startDate; date <= endDate && dates.length < limit; ) {
      dates.push(date);
      date = addLocalDays(date, draft.interval);
    }
    return dates;
  }

  if (draft.frequency === 'weekly') {
    const weekdays = new Set(draft.weekdays ?? [getLocalWeekday(startDate)]);
    for (
      let date = startDate, offset = 0;
      date <= endDate && dates.length < limit;
      date = addLocalDays(date, 1), offset += 1
    ) {
      const weekIndex = Math.floor(
        (offset + getLocalWeekday(startDate)) / 7
      );
      if (weekIndex % draft.interval === 0 && weekdays.has(getLocalWeekday(date))) {
        dates.push(date);
      }
    }
    return dates;
  }

  const monthDay = draft.monthDay ?? Number(startDate.slice(8, 10));
  const monthAnchor = `${startDate.slice(0, 8)}01`;
  for (
    let monthOffset = 0;
    dates.length < limit && monthOffset <= MAX_MONTH_OFFSET;
    monthOffset += draft.interval
  ) {
    const month = addLocalMonths(monthAnchor, monthOffset);
    if (!month) continue;
    if (month > endDate) break;
    const candidate = `${month.slice(0, 8)}${String(monthDay).padStart(2, '0')}`;
    const normalized = addLocalMonths(candidate, 0);
    if (!normalized) continue;
    if (candidate < startDate) continue;
    if (candidate > endDate) break;
    dates.push(candidate);
  }
  return dates;
}

export function materializeSeries(
  draft: PlanningSeriesDraft,
  horizonLocalDate: string
): MaterializedOccurrence[] {
  const localTime = draft.startsAtLocal.slice(11, 16);
  return getCandidateDates(draft, horizonLocalDate).map((localDate) => {
    const originalStartLocal = `${localDate}T${localTime}`;
    if (draft.timeKind === 'all_day') {
      return {
        originalStartLocal,
        timeKind: 'all_day',
        startAt: null,
        endAt: null,
        startDate: localDate,
        endDateExclusive: addLocalDays(localDate, draft.durationDays ?? 1),
        dstResolution: 'exact',
      };
    }

    const resolved = resolveBerlinWallTime(originalStartLocal);
    if (!resolved) throw new Error('invalid_series_start');
    if (!draft.durationMinutes) throw new Error('missing_timed_duration');
    const durationMinutes = draft.durationMinutes;
    return {
      originalStartLocal,
      timeKind: 'timed',
      startAt: resolved.instant.toISOString(),
      endAt: new Date(
        resolved.instant.getTime() + durationMinutes * 60_000
      ).toISOString(),
      startDate: null,
      endDateExclusive: null,
      dstResolution: resolved.resolution,
    };
  });
}

export function occurrenceIdentity(
  organizationId: string,
  lineageId: string,
  originalStartLocal: string
): string {
  return `${organizationId}:${lineageId}:${originalStartLocal}`;
}
