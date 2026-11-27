import { describe, expect, test } from 'bun:test';

import { adjustmentHoursError, HOURS_INPUT_ERROR, parseSignedHoursMinutes } from './balance-input';
import { formatMinutes } from './presentation';

describe('parseSignedHoursMinutes: an opening balance is typed as ±HH:MM', () => {
  test('a positive balance with or without plus sign is its minutes', () => {
    expect(parseSignedHoursMinutes('+12:30')).toBe(750);
    expect(parseSignedHoursMinutes('12:30')).toBe(750);
    expect(parseSignedHoursMinutes(' 0:05 ')).toBe(5);
  });

  test('a minus sign, also the typographic one, makes the balance negative', () => {
    expect(parseSignedHoursMinutes('-3:15')).toBe(-195);
    expect(parseSignedHoursMinutes('−3:15')).toBe(-195);
    expect(parseSignedHoursMinutes('- 0:30')).toBe(-30);
  });

  test('zero is zero whatever its sign', () => {
    expect(parseSignedHoursMinutes('0:00')).toBe(0);
    expect(parseSignedHoursMinutes('-0:00')).toBe(0);
  });

  test('a balance copied from the screen reads back to the same minutes', () => {
    for (const minutes of [750, -195, 0, 59, -6001])
      expect(parseSignedHoursMinutes(formatMinutes(minutes))).toBe(minutes);
  });

  test('plain minutes are refused, so 750 never turns into 750 hours or 12:30 silently', () => {
    expect(parseSignedHoursMinutes('750')).toBeNull();
    expect(parseSignedHoursMinutes('0')).toBeNull();
  });

  test('a value that is no hours-and-minutes time is refused', () => {
    for (const input of ['', '12:60', '12:5', '12,5', '+-1:00', '1:00:00', '12345:00', 'abc', ':30'])
      expect(parseSignedHoursMinutes(input)).toBeNull();
  });
});

describe('adjustmentHoursError: a correction, expiry or payout takes the same ±HH:MM', () => {
  test('signed hours and minutes pass', () => {
    for (const input of ['+12:30', '-3:15', '−0:01', '1:00 Std.'])
      expect(adjustmentHoursError(input)).toBeNull();
  });

  test('plain minutes and other text name the format', () => {
    for (const input of ['750', '', '12,5', '1:75'])
      expect(adjustmentHoursError(input)).toBe(HOURS_INPUT_ERROR);
  });

  test('zero changes no balance and is refused with its own reason', () => {
    expect(adjustmentHoursError('0:00')).toBe('Eine Korrektur von 0:00 ändert den Saldo nicht.');
    expect(adjustmentHoursError('-0:00')).toBe('Eine Korrektur von 0:00 ändert den Saldo nicht.');
  });
});
