import { describe, expect, test } from 'bun:test';
import { legacyVisitWindow, sameLegacyVisitSchedule } from './legacy-visit-window';

// The expected instants are what Postgres writes for
// `(planned_date + planned_time) at time zone 'Europe/Berlin'` in
// app_private.sync_legacy_job_planning_occurrence. A different instant makes
// app_private.record_job_visit_assessment refuse every save of such a job.
describe('the legacy visit window matches the schedule trigger', () => {
  test('a job without a time is an all-day visit on its date', () => {
    expect(
      legacyVisitWindow({ plannedDate: '2099-11-04', plannedTime: null, estimatedDurationMinutes: 240 }),
    ).toEqual({
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate: '2099-11-04',
      endDateExclusive: '2099-11-05',
    });
  });

  test('a timed job lasts its estimated duration, one hour without one', () => {
    expect(
      legacyVisitWindow({ plannedDate: '2099-07-01', plannedTime: '08:00:00', estimatedDurationMinutes: 90 }),
    ).toMatchObject({
      timeKind: 'timed',
      startAt: '2099-07-01T06:00:00.000Z',
      endAt: '2099-07-01T07:30:00.000Z',
    });
    expect(
      legacyVisitWindow({ plannedDate: '2099-11-04', plannedTime: '08:00', estimatedDurationMinutes: null }),
    ).toMatchObject({ startAt: '2099-11-04T07:00:00.000Z', endAt: '2099-11-04T08:00:00.000Z' });
  });

  test('an ambiguous autumn time is its standard-time occurrence, a spring gap time moves forward', () => {
    expect(
      legacyVisitWindow({ plannedDate: '2026-10-25', plannedTime: '02:30', estimatedDurationMinutes: 60 }),
    ).toMatchObject({ startAt: '2026-10-25T01:30:00.000Z' });
    expect(
      legacyVisitWindow({ plannedDate: '2026-03-29', plannedTime: '02:30', estimatedDurationMinutes: 60 }),
    ).toMatchObject({ startAt: '2026-03-29T01:30:00.000Z' });
  });

  test('a stored time with seconds keeps them, as the calendar projection can write it', () => {
    // A date-only or duration-only edit keeps the stored 08:00:30.
    expect(
      legacyVisitWindow({ plannedDate: '2099-11-05', plannedTime: '08:00:30', estimatedDurationMinutes: 60 }),
    ).toMatchObject({ startAt: '2099-11-05T07:00:30.000Z', endAt: '2099-11-05T08:00:30.000Z' });
    expect(
      legacyVisitWindow({
        plannedDate: '2026-03-29',
        plannedTime: '02:30:15.25',
        estimatedDurationMinutes: 60,
      }),
    ).toMatchObject({ startAt: '2026-03-29T01:30:15.250Z' });
  });

  test('a job without a date has no visit', () => {
    expect(
      legacyVisitWindow({ plannedDate: null, plannedTime: '08:00', estimatedDurationMinutes: 60 }),
    ).toBeNull();
  });
});

describe('a schedule change is what the schedule trigger counts as one', () => {
  const schedule = { plannedDate: '2099-11-04', plannedTime: '08:00:00', estimatedDurationMinutes: 60 };

  test('the same wall time in another spelling is no change', () => {
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, plannedTime: '08:00' })).toBe(true);
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, plannedTime: '8:00:00.000' })).toBe(true);
  });

  test('seconds, the date and the duration each change the visit', () => {
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, plannedTime: '08:00:30' })).toBe(false);
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, plannedDate: '2099-11-05' })).toBe(false);
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, estimatedDurationMinutes: null })).toBe(false);
    expect(sameLegacyVisitSchedule(schedule, { ...schedule, plannedTime: null })).toBe(false);
  });
});
