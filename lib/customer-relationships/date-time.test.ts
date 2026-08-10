import { describe, expect, test } from 'bun:test';

import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from './date-time';

describe('Europe/Berlin follow-up date times', () => {
  test('formats the same wall time regardless of the browser time zone', () => {
    expect(formatBerlinDateTimeInput('2026-08-10T07:00:00.000Z')).toBe(
      '2026-08-10T09:00'
    );
    expect(formatBerlinDateTimeInput('2026-01-10T08:00:00.000Z')).toBe(
      '2026-01-10T09:00'
    );
  });

  test('parses Berlin wall time to the correct summer and winter instants', () => {
    expect(parseBerlinDateTimeInput('2026-08-10T09:00')?.toISOString()).toBe(
      '2026-08-10T07:00:00.000Z'
    );
    expect(parseBerlinDateTimeInput('2026-01-10T09:00')?.toISOString()).toBe(
      '2026-01-10T08:00:00.000Z'
    );
  });

  test('rejects impossible Berlin wall times during the DST jump', () => {
    expect(parseBerlinDateTimeInput('2026-03-29T02:30')).toBeNull();
  });

  test('resolves the ambiguous autumn wall time to the standard-time occurrence', () => {
    expect(parseBerlinDateTimeInput('2026-10-25T02:30')?.toISOString()).toBe(
      '2026-10-25T01:30:00.000Z'
    );
  });

  test('returns an empty input value for invalid dates', () => {
    expect(formatBerlinDateTimeInput('not-a-date')).toBe('');
  });

  test('uses the next Berlin calendar day for the initial due date', () => {
    expect(
      tomorrowMorningInBerlin(new Date('2026-08-10T22:30:00.000Z'))
    ).toBe('2026-08-12T09:00');
  });
});
