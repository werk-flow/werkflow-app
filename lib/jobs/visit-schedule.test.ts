import { describe, expect, test } from 'bun:test';
import { jobFormEditsSchedule, jobPlanningHref, namesJobSchedule, type JobVisit } from './visit-schedule';

const visit = (date: string): JobVisit => ({
  id: `visit-${date}`,
  date,
  startAt: `${date}T07:00:00.000Z`,
  endAt: `${date}T09:00:00.000Z`,
  people: ['Max Müller'],
});

describe('the job form and the job visits', () => {
  test('the form edits the schedule of a job without a visit or with one, never with several', () => {
    expect(jobFormEditsSchedule(0)).toBe(true);
    expect(jobFormEditsSchedule(1)).toBe(true);
    expect(jobFormEditsSchedule(2)).toBe(false);
  });

  test('date, time and duration are the schedule; a cleared value is a change too', () => {
    expect(namesJobSchedule({})).toBe(false);
    expect(namesJobSchedule({ plannedDate: '2026-11-02' })).toBe(true);
    expect(namesJobSchedule({ plannedDate: null })).toBe(true);
    expect(namesJobSchedule({ plannedTime: null })).toBe(true);
    expect(namesJobSchedule({ estimatedDurationMinutes: 90 })).toBe(true);
  });

  test('the planning link opens the calendar on the first upcoming visit, or on today without one', () => {
    expect(
      jobPlanningHref({ total: 3, upcomingTotal: 2, upcoming: [visit('2026-11-02'), visit('2026-11-09')] }),
    ).toBe('/kalender?date=2026-11-02');
    expect(jobPlanningHref({ total: 2, upcomingTotal: 0, upcoming: [] })).toBe('/kalender');
  });
});
