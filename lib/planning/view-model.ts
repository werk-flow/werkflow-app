import type { CalendarJob } from '@/lib/jobs/types';
import type { PlanningCalendarEntry } from './types';

export function toCalendarJob(entry: PlanningCalendarEntry): CalendarJob {
  return {
    id: entry.occurrenceId,
    occurrenceId: entry.occurrenceId,
    jobId: entry.jobId,
    seriesId: entry.seriesId,
    seriesLineageId: entry.seriesLineageId,
    entryKind: entry.entryKind,
    internalType: entry.internalType,
    timeKind: entry.timeKind,
    startAt: entry.startAt,
    endAt: entry.endAt,
    endDateExclusive: entry.endDateExclusive,
    isException: entry.isException,
    version: entry.version,
    assignedEmployeeRecordIds: entry.assignedEmployeeRecordIds,
    jobNumber: entry.jobNumber,
    title: entry.title,
    status: entry.jobStatus ?? 'nicht_bearbeitet',
    priority: entry.priority ?? 'mittel',
    plannedDate: entry.plannedDate,
    plannedTime: entry.plannedTime,
    estimatedDurationMinutes: entry.estimatedDurationMinutes,
    plannedWorkingMinutes:
      entry.estimatedDurationMinutes && entry.assignedEmployeeRecordIds.length
        ? entry.estimatedDurationMinutes * entry.assignedEmployeeRecordIds.length
        : null,
    location: entry.location,
    clientName: entry.clientName,
    clientAddress: entry.clientAddress,
    projectName: entry.projectName,
    projectNumber: entry.projectNumber,
    assignedUserIds: entry.assignedUserIds,
  };
}
