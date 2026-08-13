import { describe, expect, test } from 'bun:test';

import {
  addLocalMonths,
  addLocalMonthsClamped,
  resolveBerlinWallTime,
  splitTimedIntervalByBerlinDate,
} from './date-time';

describe('planning Europe/Berlin wall times', () => {
  test('resolves ordinary summer and winter wall times', () => {
    expect(resolveBerlinWallTime('2026-08-10T09:00')).toEqual({
      instant: new Date('2026-08-10T07:00:00.000Z'),
      localDateTime: '2026-08-10T09:00',
      resolution: 'exact',
    });
    expect(resolveBerlinWallTime('2026-01-10T09:00')?.instant.toISOString()).toBe(
      '2026-01-10T08:00:00.000Z'
    );
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

  test('splits cross-midnight elapsed minutes by Berlin calendar date', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-08-10T21:30:00.000Z'),
        new Date('2026-08-11T01:30:00.000Z')
      )
    ).toEqual([
      { localDate: '2026-08-10', minutes: 30 },
      { localDate: '2026-08-11', minutes: 210 },
    ]);
  });

  test('keeps elapsed minutes correct across the short spring night', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-03-28T22:00:00.000Z'),
        new Date('2026-03-29T03:00:00.000Z')
      )
    ).toEqual([
      { localDate: '2026-03-28', minutes: 60 },
      { localDate: '2026-03-29', minutes: 240 },
    ]);
  });

  test('allocates 25 hours to the long autumn day', () => {
    expect(
      splitTimedIntervalByBerlinDate(
        new Date('2026-10-24T22:00:00.000Z'),
        new Date('2026-10-26T00:00:00.000Z')
      )
    ).toEqual([
      { localDate: '2026-10-25', minutes: 1500 },
      { localDate: '2026-10-26', minutes: 60 },
    ]);
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
});
