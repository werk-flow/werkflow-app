import { describe, expect, test } from 'bun:test';

import { canCorrectOpeningDate, suggestTimeAccountStartDate } from './opening-dates';

describe('the proposed start of rules and time accounts', () => {
  test('is the first day of the oldest month with recorded time while no month is closed', () => {
    expect(
      suggestTimeAccountStartDate({
        today: '2026-10-29',
        latestClosedPeriodEnd: null,
        earliestActivityDate: '2026-08-14',
      }),
    ).toBe('2026-08-01');
  });

  test('is the month after the last closed period, never a settled month', () => {
    expect(
      suggestTimeAccountStartDate({
        today: '2026-10-29',
        latestClosedPeriodEnd: '2026-08-31',
        earliestActivityDate: '2026-03-02',
      }),
    ).toBe('2026-09-01');
  });

  test('is the current month without recorded time, and never a later one', () => {
    expect(
      suggestTimeAccountStartDate({
        today: '2026-10-29',
        latestClosedPeriodEnd: null,
        earliestActivityDate: null,
      }),
    ).toBe('2026-10-01');
    expect(
      suggestTimeAccountStartDate({
        today: '2026-10-29',
        latestClosedPeriodEnd: null,
        earliestActivityDate: '2026-11-02',
      }),
    ).toBe('2026-10-01');
  });
});

describe('an opening date correction', () => {
  test('stays open while no closed period reaches the opening date', () => {
    expect(canCorrectOpeningDate('2026-10-29', null)).toBe(true);
    expect(canCorrectOpeningDate('2026-09-01', '2026-08-31')).toBe(true);
  });

  test('is locked once a closed period ends on or after the opening date', () => {
    expect(canCorrectOpeningDate('2026-08-31', '2026-08-31')).toBe(false);
    expect(canCorrectOpeningDate('2026-08-03', '2026-09-30')).toBe(false);
  });
});
