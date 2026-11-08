import { addLocalDays, parseBerlinDateTimeInput, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { normalizeJobPlannedTime } from '@/lib/jobs/types';
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

/**
 * The legacy visit's time as app_private.sync_legacy_job_planning_occurrence
 * writes it: an all-day visit on the date, or the Berlin wall time for the
 * estimated duration (one hour without one). Like Postgres, an ambiguous
 * autumn time is its standard-time occurrence and a spring gap time moves
 * forward by the gap. Null without a date.
 */
export function legacyVisitWindow(schedule: JobSchedule): VisitWindow | null {
  if (!schedule.plannedDate) return null;
  const time = normalizeJobPlannedTime(schedule.plannedTime);
  if (!time) {
    return {
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate: schedule.plannedDate,
      endDateExclusive: addLocalDays(schedule.plannedDate, 1),
    };
  }
  const localDateTime = `${schedule.plannedDate}T${time}`;
  const start = parseBerlinDateTimeInput(localDateTime) ?? resolveBerlinWallTime(localDateTime)?.instant;
  if (!start) return null;
  const end = new Date(start.getTime() + (schedule.estimatedDurationMinutes ?? 60) * 60_000);
  return {
    timeKind: 'timed',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startDate: null,
    endDateExclusive: null,
  };
}
