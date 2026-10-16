import { describe, expect, test } from 'bun:test';

import {
  addLocalDays,
  addLocalMonths,
  addLocalMonthsClamped,
  formatBerlinDateTimeInput,
  formatBerlinLocalDate,
  formatBerlinLocalDateTime,
  getLocalDayEnd,
  getLocalDayStart,
  getLocalWeekday,
  isSameLocalDay,
  parseBerlinDateTimeInput,
  resolveBerlinWallTime,
  splitTimedIntervalByBerlinDate,
  tomorrowMorningInBerlin,
} from './berlin';

describe('Berlin wall times for planning', () => {
  test('resolves ordinary summer and winter wall times', () => {
    expect(resolveBerlinWallTime('2026-08-10T09:00')).toEqual({
      instant: new Date('2026-08-10T07:00:00.000Z'),
      localDateTime: '2026-08-10T09:00',
      resolution: 'exact',
    });
    expect(resolveBerlinWallTime('2026-01-10T09:00')?.instant.toISOString()).toBe('2026-01-10T08:00:00.000Z');
  });

  test('shifts a nonexistent spring wall time forward by the DST gap', () => {
    expect(resolveBerlinWallTime('2026-03-29T02:30')).toEqual({
      instant: new Date('2026-03-29T01:30:00.000Z'),
      localDateTime: '2026-03-29T03:30',
      resolution: 'shifted_forward',
    });
  });

  test('selects the first occurrence of an ambiguous autumn wall time', () => {
    expect(resolveBerlinWallTime('2026-10-25T02:30')).toEqual({
      instant: new Date('2026-10-25T00:30:00.000Z'),
      localDateTime: '2026-10-25T02:30',
      resolution: 'first_ambiguous',
    });
  });

  test('refuses a value that names no real date and time', () => {
    for (const value of ['2026-02-30T09:00', '2026-08-10T24:00', '2026-08-10 09:00', '']) {
      expect(resolveBerlinWallTime(value), value).toBeNull();
    }
  });
});

describe('Berlin datetime-local values for follow-ups', () => {
  test('formats the same wall time regardless of the browser time zone', () => {
    expect(formatBerlinDateTimeInput('2026-08-10T07:00:00.000Z')).toBe('2026-08-10T09:00');
    expect(formatBerlinDateTimeInput('2026-01-10T08:00:00.000Z')).toBe('2026-01-10T09:00');
  });

  test('parses Berlin wall time to the correct summer and winter instants', () => {
    expect(parseBerlinDateTimeInput('2026-08-10T09:00')?.toISOString()).toBe('2026-08-10T07:00:00.000Z');
    expect(parseBerlinDateTimeInput('2026-01-10T09:00')?.toISOString()).toBe('2026-01-10T08:00:00.000Z');
  });

  test('rejects impossible Berlin wall times during the DST jump', () => {
    expect(parseBerlinDateTimeInput('2026-03-29T02:30')).toBeNull();
    expect(parseBerlinDateTimeInput('2026-02-30T09:00')).toBeNull();
  });

  test('resolves the ambiguous autumn wall time to the standard-time occurrence', () => {
    expect(parseBerlinDateTimeInput('2026-10-25T02:30')?.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  test('returns an empty input value for invalid dates', () => {
    expect(formatBerlinDateTimeInput('not-a-date')).toBe('');
    expect(() => formatBerlinLocalDateTime('not-a-date')).toThrow('invalid_instant');
  });

  test('uses the next Berlin calendar day for the initial due date', () => {
    expect(tomorrowMorningInBerlin(new Date('2026-08-10T22:30:00.000Z'))).toBe('2026-08-12T09:00');
    expect(tomorrowMorningInBerlin(new Date('2026-12-31T12:00:00.000Z'), 7)).toBe('2027-01-01T07:00');
  });
});

describe('Berlin calendar days', () => {
  test('an instant belongs to its Berlin date, not its UTC date', () => {
    expect(formatBerlinLocalDate('2026-08-10T22:30:00.000Z')).toBe('2026-08-11');
    expect(formatBerlinLocalDate(new Date('2026-01-10T22:59:00.000Z'))).toBe('2026-01-10');
    expect(isSameLocalDay(new Date('2026-08-10T21:59:00.000Z'), new Date('2026-08-10T00:00:00.000Z'))).toBe(
      true,
    );
    expect(isSameLocalDay(new Date('2026-08-10T22:00:00.000Z'), new Date('2026-08-10T12:00:00.000Z'))).toBe(
      false,
    );
  });

  // The values of the replaced time-tracking day helpers (offset formatter
  // at the UTC guess), including both DST switch days.
  test('a day starts at Berlin midnight and ends one millisecond before the next', () => {
    const days: Array<[string, string, string]> = [
      ['2026-08-10T12:00:00.000Z', '2026-08-09T22:00:00.000Z', '2026-08-10T21:59:59.999Z'],
      ['2026-01-10T12:00:00.000Z', '2026-01-09T23:00:00.000Z', '2026-01-10T22:59:59.999Z'],
      ['2026-03-29T12:00:00.000Z', '2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z'],
      ['2026-10-25T12:00:00.000Z', '2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z'],
      ['2026-08-10T22:30:00.000Z', '2026-08-10T22:00:00.000Z', '2026-08-11T21:59:59.999Z'],
    ];
    for (const [instant, start, end] of days) {
      expect(getLocalDayStart(new Date(instant)).toISOString(), instant).toBe(start);
      expect(getLocalDayEnd(new Date(instant)).toISOString(), instant).toBe(end);
    }
  });

  test('splits cross-midnight elapsed minutes by Berlin calendar date', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-08-10T21:30:00.000Z'),
        new Date('2026-08-11T01:30:00.000Z'),
      ),
    ).toEqual([
      { localDate: '2026-08-10', minutes: 30 },
      { localDate: '2026-08-11', minutes: 210 },
    ]);
  });

  test('keeps elapsed minutes correct across the short spring night', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-03-28T22:00:00.000Z'),
        new Date('2026-03-29T03:00:00.000Z'),
      ),
    ).toEqual([
      { localDate: '2026-03-28', minutes: 60 },
      { localDate: '2026-03-29', minutes: 240 },
    ]);
  });

  test('allocates 25 hours to the long autumn day', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-10-24T22:00:00.000Z'),
        new Date('2026-10-26T00:00:00.000Z'),
      ),
    ).toEqual([
      { localDate: '2026-10-25', minutes: 1500 },
      { localDate: '2026-10-26', minutes: 60 },
    ]);
  });
});

describe('local date arithmetic', () => {
  test('adds days across month, year and DST boundaries', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(addLocalDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(() => addLocalDays('2026-1-1', 1)).toThrow('invalid_local_date');
    // Date.parse rolls a day past the month's end and refuses month 13 or day 32.
    expect(addLocalDays('2026-04-31', 0)).toBe('2026-05-01');
    for (const invalid of ['2026-13-01', '2026-00-10', '2026-02-00', '2026-02-32']) {
      expect(() => addLocalDays(invalid, 1), invalid).toThrow('invalid_local_date');
    }
  });

  test('returns null for an invalid month day without normalizing it', () => {
    expect(addLocalMonths('2026-01-31', 1)).toBeNull();
    expect(addLocalMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  test('clamps invalid month days to the target month', () => {
    expect(addLocalMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addLocalMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
    expect(addLocalMonthsClamped('2026-08-12', 18)).toBe('2028-02-12');
  });

  test('numbers the weekday from Monday', () => {
    expect(getLocalWeekday('2026-08-10')).toBe(0);
    expect(getLocalWeekday('2026-08-16')).toBe(6);
    expect(() => getLocalWeekday('2026-02-30')).toThrow('invalid_local_date');
  });
});
