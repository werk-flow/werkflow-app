import { describe, expect, test } from 'bun:test';
import {
  checkPlanningEntryDraft,
  getMondayWeekday,
  plannedEntriesMessage,
  type PlanningEntryDraft,
} from './planning-entry-draft';

const validVisit: PlanningEntryDraft = {
  entryKind: 'job_visit',
  jobId: 'job-1',
  internalType: 'meeting',
  title: '',
  description: '',
  location: '',
  date: '2026-10-05',
  time: '09:00',
  timeKind: 'timed',
  durationHours: '2',
  durationDays: '1',
  employeeRecordIds: ['record-1'],
  teamIds: [],
  recurring: false,
  frequency: 'weekly',
  interval: '1',
  weekdays: [0],
  endMode: 'count',
  occurrenceCount: '6',
  untilDate: '',
  hasConflicts: false,
  overrideReason: '',
};

describe('getMondayWeekday', () => {
  test('counts Monday as 0 and Sunday as 6', () => {
    expect(getMondayWeekday('2026-10-05')).toBe(0);
    expect(getMondayWeekday('2026-10-11')).toBe(6);
  });
});

describe('plannedEntriesMessage', () => {
  test('names one entry in the singular and a series with its count', () => {
    expect(plannedEntriesMessage(1)).toBe('Termin wurde geplant.');
    expect(plannedEntriesMessage(6)).toBe('6 Termine wurden geplant.');
  });
});

describe('checkPlanningEntryDraft', () => {
  test('lists every missing input in visual order with its focus target', () => {
    const check = checkPlanningEntryDraft({
      ...validVisit,
      jobId: '',
      date: '',
      hasConflicts: true,
      overrideReason: 'kurz',
    });
    expect(check.kind).toBe('missing');
    if (check.kind !== 'missing') return;
    expect(check.inputs.map((input) => [input.field, input.elementId])).toEqual([
      ['job', 'planning-job'],
      ['date', 'planning-date'],
      ['override', 'planning-override'],
    ]);
  });

  test('requires a title instead of a job for an internal entry', () => {
    const check = checkPlanningEntryDraft({ ...validVisit, entryKind: 'internal', jobId: '', title: '  ' });
    expect(check.kind === 'missing' ? check.inputs.map((input) => input.field) : []).toEqual(['title']);
  });

  test('refuses a timed duration under 15 minutes and an all-day span over 31 days', () => {
    expect(checkPlanningEntryDraft({ ...validVisit, durationHours: '0,1' }).kind).toBe('invalid');
    expect(checkPlanningEntryDraft({ ...validVisit, timeKind: 'all_day', durationDays: '32' }).kind).toBe(
      'invalid',
    );
  });

  test('refuses an out-of-range recurrence only while recurring', () => {
    expect(checkPlanningEntryDraft({ ...validVisit, recurring: true, occurrenceCount: '1' }).kind).toBe(
      'invalid',
    );
    expect(checkPlanningEntryDraft({ ...validVisit, recurring: false, occurrenceCount: '1' }).kind).toBe(
      'ready',
    );
  });

  test('builds a timed job visit without internal fields or recurrence', () => {
    const check = checkPlanningEntryDraft(validVisit);
    expect(check).toEqual({
      kind: 'ready',
      request: {
        entryKind: 'job_visit',
        internalType: null,
        jobId: 'job-1',
        title: null,
        description: null,
        location: null,
        timeKind: 'timed',
        startsAtLocal: '2026-10-05T09:00',
        durationMinutes: 120,
        durationDays: null,
        assignmentDrafts: [{ employeeRecordId: 'record-1', teamSourceId: null }],
        teamIds: [],
        recurrence: null,
      },
    });
  });

  test('builds a monthly all-day series on the date day that ends on a date', () => {
    const check = checkPlanningEntryDraft({
      ...validVisit,
      entryKind: 'internal',
      title: 'Teamrunde',
      timeKind: 'all_day',
      durationDays: '2',
      recurring: true,
      frequency: 'monthly',
      endMode: 'until',
      untilDate: '2027-03-05',
    });
    expect(check.kind === 'ready' ? check.request : null).toMatchObject({
      jobId: null,
      title: 'Teamrunde',
      startsAtLocal: '2026-10-05T00:00',
      durationMinutes: null,
      durationDays: 2,
      recurrence: {
        frequency: 'monthly',
        interval: 1,
        weekdays: null,
        monthDay: 5,
        occurrenceCount: null,
        untilLocalDate: '2027-03-05',
      },
    });
  });
});
