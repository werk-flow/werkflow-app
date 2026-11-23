import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { parseSignedHoursMinutes } from './balance-input';
import { formatMinutes } from './presentation';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Time accounts": an Admin types each opening balance as „±HH:MM“. A balance is money, so a typed
// value is exactly its signed minutes, and a balance copied from the screen reads back unchanged.

/** The largest balance the input takes: 9999:59 hours. */
const LIMIT_MINUTES = 9_999 * 60 + 59;
const minutesArbitrary = fc.integer({ min: -LIMIT_MINUTES, max: LIMIT_MINUTES });

describe('A typed balance', () => {
  test('is the signed hours times sixty plus the minutes, with any spacing, minus sign and unit', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 9_999 }),
        fc.nat({ max: 59 }),
        fc.constantFrom('', '+', '-', '−'),
        fc.constantFrom('', ' '),
        fc.constantFrom('', ' Std.', ' Std', 'Std.'),
        (hours, minutes, sign, gap, unit) => {
          const typed = ` ${sign}${gap}${hours}:${String(minutes).padStart(2, '0')}${unit} `;
          const magnitude = hours * 60 + minutes;
          const expected = sign === '-' || sign === '−' ? -magnitude : magnitude;
          // -0:00 is zero, not negative zero.
          expect(parseSignedHoursMinutes(typed)).toBe(expected === 0 ? 0 : expected);
        },
      ),
    );
  });

  test('is refused with sixty or more minutes, or as plain minutes', () => {
    fc.assert(
      fc.property(fc.nat({ max: 9_999 }), fc.integer({ min: 60, max: 99 }), (hours, minutes) => {
        expect(parseSignedHoursMinutes(`${hours}:${minutes}`)).toBeNull();
        expect(parseSignedHoursMinutes(String(hours * 60 + minutes))).toBeNull();
      }),
    );
  });

  test('copied from the shown balance reads back to the same minutes', () => {
    fc.assert(
      fc.property(minutesArbitrary, (minutes) => {
        expect(parseSignedHoursMinutes(formatMinutes(minutes))).toBe(minutes);
      }),
      { examples: [[0], [-1], [LIMIT_MINUTES], [-LIMIT_MINUTES]] },
    );
  });
});
