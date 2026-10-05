import { describe, expect, test } from 'bun:test';
import type { CalendarJob } from '@/lib/jobs/types';
import { applyChanges, daysBetween, inverseChanges, jobInputFrom, planningInputFrom } from './job-changes';

function visit(overrides: Partial<CalendarJob> = {}): CalendarJob {
  return {
    id: 'job-1',
    title: 'Heizung warten',
    jobNumber: null,
    status: 'nicht_bearbeitet',
    executionState: null,
    priority: 'mittel',
    plannedDate: '2026-10-05',
    plannedTime: '08:00',
    estimatedDurationMinutes: 120,
    plannedWorkingMinutes: null,
    location: null,
    clientName: null,
    clientAddress: null,
    projectName: null,
    projectNumber: null,
    assignedUserIds: ['user-a'],
    assignedEmployeeRecordIds: ['record-a'],
    endDateExclusive: '2026-10-06',
    startAt: null,
    endAt: null,
    ...overrides,
  };
}

describe('daysBetween', () => {
  test('counts whole days to the exclusive end and defaults to one', () => {
    expect(daysBetween('2026-10-05', '2026-10-08')).toBe(3);
    expect(daysBetween('2026-10-05', null)).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3);
  });
});

describe('applyChanges', () => {
  test('a move keeps the span and recomputes the instants as Berlin wall time', () => {
    const moved = applyChanges(visit({ endDateExclusive: '2026-10-07' }), {
      plannedDate: '2026-10-09',
      plannedTime: '10:00',
    });
    expect(moved.plannedDate).toBe('2026-10-09');
    expect(moved.endDateExclusive).toBe('2026-10-11');
    expect(moved.startAt).toBe('2026-10-09T08:00:00.000Z');
    expect(moved.endAt).toBe('2026-10-09T10:00:00.000Z');
  });

  test('a reassignment touches neither dates nor instants', () => {
    const job = visit({ startAt: 'kept', endAt: 'kept' });
    const reassigned = applyChanges(job, { assignedUserIds: ['user-b'] });
    expect(reassigned.assignedUserIds).toEqual(['user-b']);
    expect(reassigned.endDateExclusive).toBe(job.endDateExclusive);
    expect(reassigned.startAt).toBe('kept');
  });

  test('an untimed visit keeps its stored instants', () => {
    const moved = applyChanges(visit({ plannedTime: null, startAt: 'a', endAt: 'b' }), {
      plannedDate: '2026-10-07',
    });
    expect(moved).toMatchObject({ startAt: 'a', endAt: 'b' });
  });

  test('a bar-edge drag sets the span from the start', () => {
    expect(applyChanges(visit(), { durationDays: 4 }).endDateExclusive).toBe('2026-10-09');
  });
});

describe('inverseChanges', () => {
  test('restores exactly the changed fields from the confirmed visit', () => {
    const confirmed = visit({ endDateExclusive: '2026-10-08', assignedEmployeeRecordIds: undefined });
    expect(
      inverseChanges(confirmed, {
        plannedDate: '2026-10-10',
        assignedEmployeeRecordIds: ['record-b'],
        durationDays: 1,
      }),
    ).toEqual({ plannedDate: '2026-10-05', assignedEmployeeRecordIds: [], durationDays: 3 });
    expect(inverseChanges(confirmed, { plannedTime: '09:00' })).toEqual({ plannedTime: '08:00' });
  });
});

describe('write inputs', () => {
  test('the job write clears a removed time and maps assignments to users', () => {
    expect(jobInputFrom({ plannedTime: null, assignedUserIds: ['user-b'] })).toEqual({
      plannedTime: '',
      selectedUserIds: ['user-b'],
    });
  });

  test('the planning write prefers employee records and omits an empty time', () => {
    expect(
      planningInputFrom({
        plannedTime: null,
        assignedUserIds: ['user-b'],
        assignedEmployeeRecordIds: ['record-b'],
        durationDays: 2,
      }),
    ).toEqual({ durationDays: 2, selectedEmployeeRecordIds: ['record-b'] });
    expect(planningInputFrom({ assignedUserIds: ['user-b'] })).toEqual({ selectedUserIds: ['user-b'] });
  });
});
