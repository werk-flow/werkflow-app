import { describe, expect, test } from 'bun:test';
import { legacyVisitWindow } from './legacy-visit-window';

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

  test('a job without a date has no visit', () => {
    expect(
      legacyVisitWindow({ plannedDate: null, plannedTime: '08:00', estimatedDurationMinutes: 60 }),
    ).toBeNull();
  });
});
