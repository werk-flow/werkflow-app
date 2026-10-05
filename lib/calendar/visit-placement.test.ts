import { describe, expect, test } from 'bun:test';
import type { CalendarJob } from '@/lib/jobs/types';
import type { JobParkingContext } from '@/lib/parking/types';
import { copiedVisit, unparkPlacement } from './visit-placement';

function parkedJob(overrides: Partial<CalendarJob> = {}): CalendarJob {
  return {
    id: 'job-1',
    jobId: 'job-1',
    title: 'Therme tauschen',
    jobNumber: null,
    status: 'geparkt',
    executionState: null,
    priority: 'mittel',
    plannedDate: null,
    plannedTime: null,
    estimatedDurationMinutes: null,
    plannedWorkingMinutes: null,
    location: null,
    clientName: null,
    clientAddress: null,
    projectName: null,
    projectNumber: null,
    assignedUserIds: ['user-a'],
    ...overrides,
  };
}

function context(overrides: Partial<JobParkingContext> = {}): JobParkingContext {
  return {
    jobId: 'job-1',
    blockerId: 'blocker-1',
    version: 3,
    reason: 'material',
    note: null,
    responsibleEmployeeRecordId: 'record-a',
    responsibleName: 'Anna',
    nextReviewDate: '2026-10-20',
    updatedAt: '2026-10-01T08:00:00Z',
    ...overrides,
  } satisfies JobParkingContext;
}

describe('copiedVisit', () => {
  test('keys the copy by source, date and people and detaches it from the series', () => {
    const copy = copiedVisit({
      job: parkedJob({ occurrenceId: 'occ-1', plannedDate: '2026-10-05', seriesId: 'series-1' }),
      occurrenceId: 'occ-1',
      plannedDate: '2026-10-07',
      employeeRecordIds: ['record-b', 'record-c'],
    });
    expect(copy).toMatchObject({
      id: 'copy:occ-1:2026-10-07:record-b,record-c',
      occurrenceId: 'copy:occ-1:2026-10-07:record-b,record-c',
      plannedDate: '2026-10-07',
      assignedUserIds: [],
      assignedEmployeeRecordIds: ['record-b', 'record-c'],
      seriesId: null,
      isException: false,
    });
  });
});

describe('unparkPlacement', () => {
  test('a timed drop without a duration gets four hours and adds the target person', () => {
    const placement = unparkPlacement({
      job: parkedJob(),
      parkingContext: context({ note: 'Teil bestellt' }),
      plannedDate: '2026-10-06',
      plannedTime: '09:00',
      assignToUserId: 'user-b',
    });
    expect(placement.jobId).toBe('job-1');
    expect(placement.placed).toMatchObject({
      plannedDate: '2026-10-06',
      plannedTime: '09:00',
      estimatedDurationMinutes: 240,
      assignedUserIds: ['user-a', 'user-b'],
      status: 'nicht_bearbeitet',
    });
    expect(placement.schedule).toEqual({
      plannedDate: '2026-10-06',
      plannedTime: '09:00',
      estimatedDurationMinutes: 240,
      selectedUserIds: ['user-a', 'user-b'],
    });
    expect(placement.restoreContext).toEqual({
      reason: 'material',
      details: 'Teil bestellt',
      responsibleEmployeeRecordId: 'record-a',
      nextReviewDate: '2026-10-20',
    });
  });

  test('an all-day drop keeps the duration, an assigned person is not repeated', () => {
    const placement = unparkPlacement({
      job: parkedJob({ estimatedDurationMinutes: 90 }),
      parkingContext: context({ nextReviewDate: null }),
      plannedDate: '2026-10-06',
      assignToUserId: 'user-a',
    });
    expect(placement.schedule).toEqual({
      plannedDate: '2026-10-06',
      plannedTime: '',
      selectedUserIds: ['user-a'],
    });
    expect(placement.placed.plannedTime).toBeNull();
    expect(placement.restoreContext).toBeNull();
  });
});
