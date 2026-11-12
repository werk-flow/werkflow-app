import { describe, expect, test } from 'bun:test';
import { centsToEuroInput, formatTaxRate, parseEuroCents } from './money';

describe('a typed euro amount becomes exact cents or is refused', () => {
  const cases: Array<[string, number | null | undefined]> = [
    ['', null],
    ['   ', null],
    ['65', 6500],
    ['65,5', 6550],
    ['65,50', 6550],
    ['65.50', 6550],
    ['0,01', 1],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['12,34 €', 1234],
    ['1000000', 100_000_000],
    // Not one meaning, or not an amount a version stores.
    ['1.234', undefined],
    ['1,234', undefined],
    ['12,345', undefined],
    ['1.23,45', undefined],
    ['-5', undefined],
    ['abc', undefined],
    ['1000000,01', undefined],
    // A float would make 0,29 € 28 cents; the parse never multiplies a fraction.
    ['0,29', 29],
    ['1.005,07', 100507],
  ];
  for (const [text, expected] of cases) {
    test(`„${text}“ is ${String(expected)}`, () => {
      expect(parseEuroCents(text)).toBe(expected);
    });
  }
});

test('an amount field shows cents with a decimal comma and parses back to the same cents', () => {
  for (const cents of [0, 1, 29, 6550, 123456]) {
    expect(parseEuroCents(centsToEuroInput(cents))).toBe(cents);
  }
  expect(centsToEuroInput(null)).toBe('');
});

test('a tax rate reads as a German percentage', () => {
  expect(formatTaxRate(1900)).toBe('19 %');
  expect(formatTaxRate(700)).toBe('7 %');
  expect(formatTaxRate(0)).toBe('0 %');
});
