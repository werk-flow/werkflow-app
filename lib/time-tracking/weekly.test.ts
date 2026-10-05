import { describe, expect, test } from 'bun:test';

import { computeWeekLabel, getTodayIndex, getWeekBounds } from './weekly';

// The server renders in UTC. 2026-09-27T22:30Z is Sunday in UTC but Monday
// 00:30 in Berlin (CEST): the overview must already show the new week.
const MONDAY_JUST_AFTER_BERLIN_MIDNIGHT = new Date('2026-09-27T22:30:00Z');

describe('the Berlin calendar week', () => {
  test('starts at Monday 00:00 Berlin and ends at Sunday 23:59:59.999 Berlin', () => {
    const { monday, sunday } = getWeekBounds(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT);
    expect(monday.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(sunday.toISOString()).toBe('2026-10-04T21:59:59.999Z');
  });

  test('counts today on the Berlin date, not the runtime date', () => {
    expect(getTodayIndex(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT)).toBe(0);
    expect(getTodayIndex(new Date('2026-10-04T21:59:00Z'))).toBe(6);
  });

  test('labels the week by its Berlin dates and ISO week', () => {
    const { monday } = getWeekBounds(MONDAY_JUST_AFTER_BERLIN_MIDNIGHT);
    expect(computeWeekLabel(monday)).toEqual({
      dateRange: 'Diese Woche (28.09. - 02.10.)',
      kw: 'KW 40',
    });
  });

  test('keeps whole days across the switch to winter time', () => {
    const { monday, sunday } = getWeekBounds(new Date('2026-10-21T12:00:00Z'));
    expect(monday.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(sunday.toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});
