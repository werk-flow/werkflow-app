import { describe, expect, test } from 'bun:test';

import { formatDuration, formatSignedDuration } from './helpers';

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
