import { addLocalDays, parseBerlinDateTimeInput, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import type { MaterializedOccurrence } from './types';

/** When a visit takes place: an instant range, or a range of Berlin days. */
export type VisitWindow = Pick<
  MaterializedOccurrence,
  'timeKind' | 'startAt' | 'endAt' | 'startDate' | 'endDateExclusive'
>;

/** The job columns the legacy visit takes its time from. */
export type JobSchedule = {
  plannedDate: string | null;
  plannedTime: string | null;
  estimatedDurationMinutes: number | null;
};

/** A `time` column value as Postgres keeps it: the wall-clock minute, and the seconds within it. */
function parsePlannedTime(
  time: string | null,
): { minute: string; secondsMs: number; canonical: string } | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?\s*$/.exec(time ?? '');
  if (!match) return null;
  const [, hours = '', minutes = '', seconds = '00', fraction = ''] = match;
  const fractionDigits = fraction.replace(/0+$/, '');
  return {
    minute: `${hours.padStart(2, '0')}:${minutes}`,
    secondsMs: Number(seconds) * 1000 + Math.round(Number(`0.${fraction || '0'}`) * 1000),
    canonical: `${hours.padStart(2, '0')}:${minutes}:${seconds}${fractionDigits ? `.${fractionDigits}` : ''}`,
  };
}

/**
 * Whether two schedules give the legacy visit the same time, as the schedule
 * trigger compares them (`is distinct from` on the columns): 08:00 is
 * 08:00:00, and 08:00:30 is another time.
 */
export function sameLegacyVisitSchedule(left: JobSchedule, right: JobSchedule): boolean {
  return (
    left.plannedDate === right.plannedDate &&
    (parsePlannedTime(left.plannedTime)?.canonical ?? left.plannedTime) ===
      (parsePlannedTime(right.plannedTime)?.canonical ?? right.plannedTime) &&
    left.estimatedDurationMinutes === right.estimatedDurationMinutes
  );
}

/**
 * The legacy visit's time as app_private.sync_legacy_job_planning_occurrence
 * writes it: an all-day visit on the date, or the Berlin wall time, seconds
 * included, for the estimated duration (one hour without one). Like Postgres,
 * an ambiguous autumn time is its standard-time occurrence and a spring gap
 * time moves forward by the gap. Null without a date.
 */
export function legacyVisitWindow(schedule: JobSchedule): VisitWindow | null {
  if (!schedule.plannedDate) return null;
  if (!schedule.plannedTime) {
    return {
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate: schedule.plannedDate,
      endDateExclusive: addLocalDays(schedule.plannedDate, 1),
    };
  }
  const time = parsePlannedTime(schedule.plannedTime);
  if (!time) return null;
  const localDateTime = `${schedule.plannedDate}T${time.minute}`;
  const minuteStart =
    parseBerlinDateTimeInput(localDateTime) ?? resolveBerlinWallTime(localDateTime)?.instant;
  if (!minuteStart) return null;
  const start = new Date(minuteStart.getTime() + time.secondsMs);
  const end = new Date(start.getTime() + (schedule.estimatedDurationMinutes ?? 60) * 60_000);
  return {
    timeKind: 'timed',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startDate: null,
    endDateExclusive: null,
  };
}
