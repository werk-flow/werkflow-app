import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import { applyChanges } from './job-changes';

/** The optimistic card of an Alt-drag copy, keyed by a temporary id until the read brings the real one. */
export function copiedVisit({
  job,
  occurrenceId,
  plannedDate,
  employeeRecordIds,
}: {
  job: CalendarJob;
  occurrenceId: string;
  plannedDate: string;
  employeeRecordIds: string[];
}): CalendarJob {
  const temporaryId = `copy:${occurrenceId}:${plannedDate}:${employeeRecordIds.join(',')}`;
  return {
    ...applyChanges(job, {
      plannedDate,
      assignedEmployeeRecordIds: employeeRecordIds,
      assignedUserIds: [],
    }),
    id: temporaryId,
    occurrenceId: temporaryId,
    seriesId: null,
    isException: false,
  };
}

export type UnparkRequest = {
  job: CalendarJob;
  parkingContext: JobParkingContext;
  plannedDate: string;
  plannedTime?: string | undefined;
  assignToUserId?: string | undefined;
  durationMinutes?: number | undefined;
};

export type UnparkPlacement = {
  jobId: string;
  /** The card as the grid shows it before the write resolves. */
  placed: CalendarJob;
  /** The schedule write; the warning path repeats it with the approval. */
  schedule: {
    plannedDate: string;
    plannedTime: string;
    estimatedDurationMinutes?: number | null;
    selectedUserIds: string[];
  };
  /** The Parkplatz context that Undo restores; null when it cannot be restored. */
  restoreContext: {
    reason: JobParkingContext['reason'];
    details?: string;
    responsibleEmployeeRecordId: string;
    nextReviewDate: string;
  } | null;
};

/** Where an unparked job lands: a timed drop without a duration gets four hours unless the drop says otherwise. */
export function unparkPlacement(request: UnparkRequest): UnparkPlacement {
  const { job, parkingContext } = request;
  const durationMinutes =
    request.plannedTime && job.estimatedDurationMinutes == null
      ? (request.durationMinutes ?? 240)
      : job.estimatedDurationMinutes;
  const assignedUserIds =
    request.assignToUserId && !job.assignedUserIds.includes(request.assignToUserId)
      ? [...job.assignedUserIds, request.assignToUserId]
      : job.assignedUserIds;
  return {
    jobId: job.jobId ?? job.id,
    placed: {
      ...job,
      plannedDate: request.plannedDate,
      plannedTime: request.plannedTime ?? null,
      estimatedDurationMinutes: durationMinutes,
      assignedUserIds,
      status: 'nicht_bearbeitet',
    },
    schedule: {
      plannedDate: request.plannedDate,
      plannedTime: request.plannedTime ?? '',
      ...(durationMinutes !== job.estimatedDurationMinutes
        ? { estimatedDurationMinutes: durationMinutes }
        : {}),
      selectedUserIds: assignedUserIds,
    },
    restoreContext:
      parkingContext.responsibleEmployeeRecordId && parkingContext.nextReviewDate
        ? {
            reason: parkingContext.reason,
            ...(parkingContext.note !== null ? { details: parkingContext.note } : {}),
            responsibleEmployeeRecordId: parkingContext.responsibleEmployeeRecordId,
            nextReviewDate: parkingContext.nextReviewDate,
          }
        : null,
  };
}
