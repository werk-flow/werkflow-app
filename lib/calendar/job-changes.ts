import type { CalendarJob } from '@/lib/jobs/types';
import type { UpdateJobInput } from '@/lib/jobs/actions';
import type { UpdatePlanningCalendarInput } from '@/lib/planning/actions';
import { addLocalDays, resolveBerlinWallTime } from '@/lib/planning/date-time';

/**
 * The fields one calendar gesture changes on a visit, and the pure steps the
 * optimistic owner (`components/kalender/mutations/use-calendar-mutations.ts`)
 * builds from them: the optimistic result, the inverse for Undo and the inputs
 * of the two write actions.
 */
export type MoveJobChanges = {
  plannedDate?: string;
  plannedTime?: string | null;
  estimatedDurationMinutes?: number | null;
  assignedUserIds?: string[];
  assignedEmployeeRecordIds?: string[];
  /** All-day span in days (the bar-edge drag); the end date follows the start. */
  durationDays?: number;
};

/** Whole days from a start date to an exclusive end date; one day when the end is missing. */
export function daysBetween(startDate: string, endDateExclusive: string | null | undefined): number {
  if (!endDateExclusive) return 1;
  return Math.round(
    (Date.parse(`${endDateExclusive}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  );
}

/** The visit as it looks after the gesture. */
export function applyChanges(job: CalendarJob, changes: MoveJobChanges): CalendarJob {
  return {
    ...job,
    ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
    ...(changes.plannedTime !== undefined ? { plannedTime: changes.plannedTime } : {}),
    ...(changes.estimatedDurationMinutes !== undefined
      ? { estimatedDurationMinutes: changes.estimatedDurationMinutes }
      : {}),
    ...(changes.assignedUserIds !== undefined ? { assignedUserIds: changes.assignedUserIds } : {}),
    ...(changes.assignedEmployeeRecordIds !== undefined
      ? { assignedEmployeeRecordIds: changes.assignedEmployeeRecordIds }
      : {}),
    ...(changes.durationDays !== undefined || changes.plannedDate !== undefined
      ? {
          endDateExclusive: addLocalDays(
            changes.plannedDate ?? job.plannedDate ?? '',
            changes.durationDays ?? daysBetween(job.plannedDate ?? '', job.endDateExclusive),
          ),
        }
      : {}),
    // A moved timed occurrence keeps its instants coherent for capacity math.
    ...(changes.plannedDate !== undefined ||
    changes.plannedTime !== undefined ||
    changes.estimatedDurationMinutes !== undefined
      ? recomputeInstants(job, changes)
      : {}),
  };
}

function recomputeInstants(
  job: CalendarJob,
  changes: MoveJobChanges,
): Pick<CalendarJob, 'startAt' | 'endAt'> {
  const date = changes.plannedDate ?? job.plannedDate;
  const time = changes.plannedTime === undefined ? job.plannedTime : changes.plannedTime;
  const duration =
    changes.estimatedDurationMinutes === undefined
      ? job.estimatedDurationMinutes
      : changes.estimatedDurationMinutes;
  const unchanged = { startAt: job.startAt ?? null, endAt: job.endAt ?? null };
  if (!date || !time || !duration) return unchanged;
  // Planned times are Berlin wall times, whatever the browser's own zone is.
  const resolved = resolveBerlinWallTime(`${date}T${time.slice(0, 5)}`);
  if (!resolved) return unchanged;
  const start = resolved.instant;
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + duration * 60_000).toISOString() };
}

/** The changes that restore every field the gesture changed to its confirmed value. */
export function inverseChanges(confirmed: CalendarJob, changes: MoveJobChanges): MoveJobChanges {
  return {
    ...(changes.plannedDate !== undefined ? { plannedDate: confirmed.plannedDate ?? '' } : {}),
    ...(changes.plannedTime !== undefined ? { plannedTime: confirmed.plannedTime } : {}),
    ...(changes.estimatedDurationMinutes !== undefined
      ? { estimatedDurationMinutes: confirmed.estimatedDurationMinutes }
      : {}),
    ...(changes.assignedUserIds !== undefined ? { assignedUserIds: confirmed.assignedUserIds } : {}),
    ...(changes.assignedEmployeeRecordIds !== undefined
      ? { assignedEmployeeRecordIds: confirmed.assignedEmployeeRecordIds ?? [] }
      : {}),
    ...(changes.durationDays !== undefined && confirmed.plannedDate
      ? { durationDays: daysBetween(confirmed.plannedDate, confirmed.endDateExclusive) }
      : {}),
  };
}

/** The job write's input for a gesture on a legacy job card. */
export function jobInputFrom(changes: MoveJobChanges): UpdateJobInput {
  return {
    ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
    ...(changes.plannedTime !== undefined ? { plannedTime: changes.plannedTime ?? '' } : {}),
    ...(changes.estimatedDurationMinutes !== undefined
      ? { estimatedDurationMinutes: changes.estimatedDurationMinutes }
      : {}),
    ...(changes.assignedUserIds !== undefined ? { selectedUserIds: changes.assignedUserIds } : {}),
  };
}

/** The planning write's input for a gesture on a planning occurrence. */
export function planningInputFrom(changes: MoveJobChanges): UpdatePlanningCalendarInput {
  return {
    ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
    ...(changes.plannedTime ? { plannedTime: changes.plannedTime } : {}),
    ...(changes.estimatedDurationMinutes !== undefined
      ? { estimatedDurationMinutes: changes.estimatedDurationMinutes }
      : {}),
    ...(changes.durationDays !== undefined ? { durationDays: changes.durationDays } : {}),
    ...(changes.assignedEmployeeRecordIds !== undefined
      ? { selectedEmployeeRecordIds: changes.assignedEmployeeRecordIds }
      : changes.assignedUserIds !== undefined
        ? { selectedUserIds: changes.assignedUserIds }
        : {}),
  };
}
