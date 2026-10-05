import { describe, expect, test } from 'bun:test';

import type { PlanningCalendarEntry } from './types';
import { toCalendarJob } from './view-model';

function entry(patch: Partial<PlanningCalendarEntry> = {}): PlanningCalendarEntry {
  return {
    id: 'occurrence-1',
    occurrenceId: 'occurrence-1',
    jobId: 'job-1',
    seriesId: null,
    seriesLineageId: null,
    entryKind: 'job_visit',
    internalType: null,
    timeKind: 'timed',
    status: 'scheduled',
    version: 1,
    isException: false,
    title: 'Heizung warten',
    description: null,
    location: null,
    plannedDate: '2026-10-05',
    plannedTime: '09:00',
    startAt: '2026-10-05T07:00:00Z',
    endDateExclusive: null,
    endAt: '2026-10-05T08:00:00Z',
    estimatedDurationMinutes: 60,
    assignedEmployeeRecordIds: ['record-1'],
    assignedUserIds: ['user-1'],
    jobNumber: 'A-001',
    jobStatus: 'nicht_bearbeitet',
    jobExecutionVersion: 3,
    jobExecutionState: 'in_progress',
    priority: 'mittel',
    clientName: null,
    clientAddress: null,
    projectName: null,
    projectNumber: null,
    ...patch,
  };
}

describe('toCalendarJob', () => {
  test('carries the job work state, so the card shows the work state and not the legacy status', () => {
    const job = toCalendarJob(entry());
    expect(job.executionState).toBe('in_progress');
    expect(job.status).toBe('nicht_bearbeitet');
  });

  test('keeps a missing work state null, so a legacy job falls back to its legacy status', () => {
    expect(toCalendarJob(entry({ jobExecutionState: null })).executionState).toBeNull();
  });

  test('an internal entry has no work state', () => {
    const internal = entry({
      entryKind: 'internal',
      internalType: 'meeting',
      jobId: null,
      jobStatus: null,
      jobExecutionState: null,
    });
    expect(toCalendarJob(internal).executionState).toBeNull();
  });
});
