import { describe, expect, test } from 'bun:test';

import {
  getEasterSunday,
  getHolidayName,
  getPublicHolidaysForYear,
} from './holidays';

// These assertions mirror the officially published holiday lists. If a state
// changes its holiday law, this test must fail so the dataset is updated
// deliberately (owner decision: in-code dataset with CI drift detection).

describe('getEasterSunday', () => {
  test('matches the published Easter dates', () => {
    expect(getEasterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(getEasterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(getEasterSunday(2028)).toEqual({ month: 4, day: 16 });
  });
});

describe('getPublicHolidaysForYear', () => {
  test('Bayern (katholisch) 2026 has the full official list', () => {
    const dates = getPublicHolidaysForYear('BY', 2026).map((h) => h.date);
    expect(dates).toEqual([
      '2026-01-01', // Neujahr
      '2026-01-06', // Heilige Drei Könige
      '2026-04-03', // Karfreitag
      '2026-04-06', // Ostermontag
      '2026-05-01', // Tag der Arbeit
      '2026-05-14', // Christi Himmelfahrt
      '2026-05-25', // Pfingstmontag
      '2026-06-04', // Fronleichnam
      '2026-08-15', // Mariä Himmelfahrt
      '2026-10-03', // Tag der Deutschen Einheit
      '2026-11-01', // Allerheiligen
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  test('Bayern ohne Mariä Himmelfahrt drops exactly that holiday', () => {
    const withMariae = getPublicHolidaysForYear('BY', 2026).map((h) => h.date);
    const without = getPublicHolidaysForYear('BY_OHNE_MARIAE', 2026).map(
      (h) => h.date
    );
    expect(without).toEqual(withMariae.filter((d) => d !== '2026-08-15'));
  });

  test('Nordrhein-Westfalen 2027 official list', () => {
    const dates = getPublicHolidaysForYear('NW', 2027).map((h) => h.date);
    expect(dates).toEqual([
      '2027-01-01',
      '2027-03-26', // Karfreitag
      '2027-03-29', // Ostermontag
      '2027-05-01',
      '2027-05-06', // Christi Himmelfahrt
      '2027-05-17', // Pfingstmontag
      '2027-05-27', // Fronleichnam
      '2027-10-03',
      '2027-11-01', // Allerheiligen
      '2027-12-25',
      '2027-12-26',
    ]);
  });

  test('Sachsen has Buß- und Bettag on the Wednesday before Nov 23', () => {
    expect(getHolidayName('SN', '2026-11-18')).toBe('Buß- und Bettag');
    expect(getHolidayName('SN', '2027-11-17')).toBe('Buß- und Bettag');
    // Not a holiday anywhere else.
    expect(getHolidayName('BY', '2026-11-18')).toBeNull();
  });

  test('Brandenburg includes Oster- and Pfingstsonntag plus Reformationstag', () => {
    expect(getHolidayName('BB', '2026-04-05')).toBe('Ostersonntag');
    expect(getHolidayName('BB', '2026-05-24')).toBe('Pfingstsonntag');
    expect(getHolidayName('BB', '2026-10-31')).toBe('Reformationstag');
    expect(getHolidayName('NW', '2026-10-31')).toBeNull();
  });

  test('Berlin has Internationaler Frauentag, Hamburg does not', () => {
    expect(getHolidayName('BE', '2026-03-08')).toBe('Internationaler Frauentag');
    expect(getHolidayName('HH', '2026-03-08')).toBeNull();
  });

  test('Weltkindertag only in Thüringen', () => {
    expect(getHolidayName('TH', '2026-09-20')).toBe('Weltkindertag');
    expect(getHolidayName('ST', '2026-09-20')).toBeNull();
  });
});
