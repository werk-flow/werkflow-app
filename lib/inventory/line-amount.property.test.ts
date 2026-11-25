import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  priceCentsArbitrary,
  priceQuantityArbitrary,
  quantityText,
  quantityThousandthsArbitrary,
  roundHalfAwayFromZero,
} from '@/lib/testing/invoice-arbitraries';
import { lineAmountCents } from './line-amount';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md: a line amount is quantity × price ÷ price quantity,
// rounded half away from zero to the cent once per line, in integer arithmetic; a credit is negative.

const THOUSAND = BigInt(1000);
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** The exact line amount by the oracle. */
const expectedCents = (thousandths: bigint, price: number, priceQuantity: number): bigint =>
  roundHalfAwayFromZero(thousandths * BigInt(price), BigInt(priceQuantity) * THOUSAND);

/** Whether the amount fits a JavaScript number exactly; beyond that the rule refuses the line. */
const representable = (cents: bigint): boolean => cents <= SAFE && cents >= -SAFE;

describe('A line amount', () => {
  test('is quantity × price ÷ price quantity, rounded half away from zero to the cent', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, price, priceQuantity) => {
          const expected = expectedCents(thousandths, price, priceQuantity);
          const amount = () => lineAmountCents(quantityText(thousandths), price, priceQuantity);
          if (representable(expected)) expect(amount()).toBe(Number(expected));
          else expect(amount).toThrow(RangeError);
        },
      ),
      {
        examples: [
          [BigInt(-5), 1, 1],
          [BigInt(-90_071_996_151), 99_999_996, 1],
        ],
      },
    );
  });

  test('lies within half a cent of the exact amount', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, price, priceQuantity) => {
          fc.pre(representable(expectedCents(thousandths, price, priceQuantity)));
          const denominator = BigInt(priceQuantity) * THOUSAND;
          const cents = BigInt(lineAmountCents(quantityText(thousandths), price, priceQuantity));
          const error = cents * denominator - thousandths * BigInt(price);
          expect((error < BigInt(0) ? -error : error) * BigInt(2) <= denominator).toBe(true);
        },
      ),
    );
  });

  test('of a credit is the negative of the same charge', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, price, priceQuantity) => {
          fc.pre(representable(expectedCents(thousandths, price, priceQuantity)));
          const charge = lineAmountCents(quantityText(thousandths), price, priceQuantity);
          const credit = lineAmountCents(quantityText(-thousandths), price, priceQuantity);
          expect(credit + charge).toBe(0);
        },
      ),
    );
  });

  test('is the same for the stored text and for its count of thousandths', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, price, priceQuantity) => {
          fc.pre(representable(expectedCents(thousandths, price, priceQuantity)));
          expect(lineAmountCents({ thousandths }, price, priceQuantity)).toBe(
            lineAmountCents(quantityText(thousandths), price, priceQuantity),
          );
        },
      ),
    );
  });

  test('of whole pieces at a price per piece is exact', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), priceCentsArbitrary, (pieces, price) => {
        expect(lineAmountCents(String(pieces), price, 1)).toBe(pieces * price + 0);
      }),
    );
  });

  test('refuses a price that is not whole cents', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        fc.double({ min: -1e6, max: 1e6, noNaN: true }).filter((value) => !Number.isInteger(value)),
        (thousandths, price) => {
          expect(() => lineAmountCents(quantityText(thousandths), price, 1)).toThrow(RangeError);
        },
      ),
    );
  });
});
