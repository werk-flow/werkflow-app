import { expect, test } from 'bun:test';

import { formatDecimalDe, parseBoundedDecimalInput, parseDecimalInput } from '@/lib/ui/decimal';

test('a bounded decimal accepts whole numbers and up to its fractional digits', () => {
  expect(parseBoundedDecimalInput('35', 2)).toBe(35);
  expect(parseBoundedDecimalInput(' 28 ', 1)).toBe(28);
  expect(parseBoundedDecimalInput('37,5', 2)).toBe(37.5);
  expect(parseBoundedDecimalInput('37.25', 2)).toBe(37.25);
  expect(parseBoundedDecimalInput('', 2)).toBeNull();
  expect(parseBoundedDecimalInput('   ', 1)).toBeNull();
});

test('a bounded decimal refuses extra fractional digits and non-numbers', () => {
  expect(parseBoundedDecimalInput('37,255', 2)).toBeUndefined();
  expect(parseBoundedDecimalInput('28,25', 1)).toBeUndefined();
  expect(parseBoundedDecimalInput('d', 2)).toBeUndefined();
  expect(parseBoundedDecimalInput('-5', 2)).toBeUndefined();
  expect(parseBoundedDecimalInput('3,', 2)).toBeUndefined();
  expect(parseBoundedDecimalInput('1.234,5', 2)).toBeUndefined();
});

test('a decimal comma makes dots thousands separators', () => {
  expect(parseDecimalInput('1.234,5')).toBe(1234.5);
  expect(parseDecimalInput('0,125')).toBe(0.125);
  expect(parseDecimalInput('2.5')).toBe(2.5);
  expect(parseDecimalInput('abc')).toBe(0);
});

test('a stored three-digit quantity round-trips through the de-DE field text', () => {
  for (const quantity of [0.125, 1.005, 12.5, 3]) {
    expect(parseDecimalInput(formatDecimalDe(quantity, 3))).toBe(quantity);
  }
});
