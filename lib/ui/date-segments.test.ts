import { describe, expect, test } from 'bun:test';
import { buildDateFromSegments } from './date-segments';

describe('buildDateFromSegments', () => {
  test('builds a local-midnight date', () => {
    const date = buildDateFromSegments(5, 3, 2026);
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(5);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
  });

  test('clamps the day to the last day of the month', () => {
    expect(buildDateFromSegments(31, 2, 2024)?.getDate()).toBe(29);
    expect(buildDateFromSegments(31, 2, 2025)?.getDate()).toBe(28);
    expect(buildDateFromSegments(31, 4, 2025)?.getDate()).toBe(30);
  });

  test('keeps intermediate short years literal', () => {
    expect(buildDateFromSegments(1, 1, 202)?.getFullYear()).toBe(202);
  });

  test('returns undefined when a segment is below 1', () => {
    expect(buildDateFromSegments(0, 1, 2026)).toBeUndefined();
    expect(buildDateFromSegments(1, 0, 2026)).toBeUndefined();
    expect(buildDateFromSegments(1, 1, 0)).toBeUndefined();
  });
});
