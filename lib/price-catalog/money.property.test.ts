import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { MAX_PRICE_CENTS, centsToEuroInput, parseEuroCents } from './money';

// Property tests (docs/technical/testing.md, "Property tests"). A typed euro amount is integer
// cents and never passes through a float (lib/price-catalog/money.ts, docs/features/
// commercial-and-finance.md: a net price in cents).

const centsArbitrary = fc.integer({ min: 0, max: MAX_PRICE_CENTS });

/** „1.234.567,89“: the amount with thousands dots and a decimal comma. */
function grouped(cents: number): string {
  const whole = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+$)/g, '.');
  return `${whole},${String(cents % 100).padStart(2, '0')}`;
}

describe('A typed euro amount', () => {
  test('reads back the cents its field starts with', () => {
    fc.assert(
      fc.property(centsArbitrary, (cents) => {
        expect(parseEuroCents(centsToEuroInput(cents))).toBe(cents);
      }),
    );
  });

  test('reads the same with thousands dots, a decimal dot, a euro sign and spaces', () => {
    fc.assert(
      fc.property(centsArbitrary, (cents) => {
        const whole = Math.trunc(cents / 100);
        const fraction = String(cents % 100).padStart(2, '0');
        expect(parseEuroCents(grouped(cents))).toBe(cents);
        expect(parseEuroCents(`${whole}.${fraction}`)).toBe(cents);
        expect(parseEuroCents(` ${grouped(cents)} €`)).toBe(cents);
      }),
    );
  });

  test('is whole cents within the catalog limit, or refused', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('0', '1', '9', ',', '.', ' ', '€', '-', 'e') }),
        (text) => {
          const cents = parseEuroCents(text);
          if (typeof cents === 'number') {
            expect(Number.isSafeInteger(cents)).toBe(true);
            expect(cents).toBeGreaterThanOrEqual(0);
            expect(cents).toBeLessThanOrEqual(MAX_PRICE_CENTS);
          }
        },
      ),
    );
  });

  test('refuses an amount above one million euros and a third decimal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_PRICE_CENTS + 1, max: 100 * MAX_PRICE_CENTS }),
        centsArbitrary,
        (above, cents) => {
          expect(parseEuroCents(centsToEuroInput(above))).toBeUndefined();
          expect(parseEuroCents(`${centsToEuroInput(cents)}5`)).toBeUndefined();
        },
      ),
    );
  });
});
