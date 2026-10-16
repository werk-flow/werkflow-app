import { describe, expect, test } from 'bun:test';

import { formatDuration, formatSignedDuration, liveMinutes } from './helpers';

describe('liveMinutes', () => {
  const nowMs = Date.parse('2026-09-03T10:30:00.000Z');

  test('adds the minutes a running status has added since it started', () => {
    expect(liveMinutes(120, '2026-09-03T10:00:00.000Z', nowMs)).toBe(150);
    expect(liveMinutes(0, '2026-09-03T10:29:30.000Z', nowMs)).toBe(0.5);
  });

  test('adds nothing when nothing runs, the start is unreadable or lies ahead of the clock', () => {
    expect(liveMinutes(120, null, nowMs)).toBe(120);
    expect(liveMinutes(120, 'kein Zeitpunkt', nowMs)).toBe(120);
    expect(liveMinutes(120, '2026-09-03T10:31:00.000Z', nowMs)).toBe(120);
  });
});

describe('formatDuration', () => {
  test('renders minutes, hours, or both in German units', () => {
    expect(formatDuration(0)).toBe('0 Min.');
    expect(formatDuration(45)).toBe('45 Min.');
    expect(formatDuration(120)).toBe('2 Std.');
    expect(formatDuration(510)).toBe('8 Std. 30 Min.');
  });

  test('rounds to whole minutes before splitting, so no part reads 60 Min.', () => {
    expect(formatDuration(44.4)).toBe('44 Min.');
    expect(formatDuration(119.6)).toBe('2 Std.');
    expect(formatDuration(89.5)).toBe('1 Std. 30 Min.');
  });
});

describe('formatSignedDuration', () => {
  test('prefixes the sign and formats the magnitude', () => {
    expect(formatSignedDuration(90)).toBe('+1 Std. 30 Min.');
    expect(formatSignedDuration(-45)).toBe('−45 Min.');
    expect(formatSignedDuration(-120)).toBe('−2 Std.');
  });

  test('counts zero as positive', () => {
    expect(formatSignedDuration(0)).toBe('+0 Min.');
  });
});
