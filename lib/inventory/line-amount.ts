// The one line arithmetic rule for material, offer and order lines: a line
// amount is quantity × amount ÷ price quantity, rounded half away from zero to
// the cent once per line. A line may be negative (a discount or a credit):
// -0,5 cent becomes -1. The arithmetic is integer only; a quantity never
// passes through a JavaScript float. A later SQL twin must pass the table of
// cases in line-amount.test.ts.

/** Base units one price is stated for, as wholesalers state prices. */
export type PriceQuantity = 1 | 10 | 100 | 1000;

/**
 * A quantity in the base unit: a decimal string with at most three decimals
 * ("0.125", "-2"), as `numeric(12,3)` stores it, or the same value as an
 * integer count of thousandths.
 */
export type LineQuantity = string | { thousandths: bigint };

const ZERO = BigInt(0);
const TWO = BigInt(2);
const THOUSAND = BigInt(1000);

const QUANTITY_TEXT = /^(-?)(\d{1,9})(?:\.(\d{1,3}))?$/;

function quantityThousandths(quantity: LineQuantity): bigint {
  if (typeof quantity !== 'string') return quantity.thousandths;
  const match = QUANTITY_TEXT.exec(quantity);
  if (!match) throw new RangeError('A line quantity has at most nine digits and three decimals.');
  const [, sign = '', whole = '0', fraction = ''] = match;
  const magnitude = BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, '0'));
  return sign === '-' ? -magnitude : magnitude;
}

/** The line amount in cents, rounded half away from zero. */
export function lineAmountCents(
  quantity: LineQuantity,
  amountCents: number,
  priceQuantity: PriceQuantity,
): number {
  if (!Number.isSafeInteger(amountCents)) throw new RangeError('An amount is a whole number of cents.');
  const numerator = quantityThousandths(quantity) * BigInt(amountCents);
  const denominator = BigInt(priceQuantity) * THOUSAND;
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const rounded = (magnitude * TWO + denominator) / (denominator * TWO);
  const cents = numerator < ZERO ? -rounded : rounded;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('The line amount exceeds the safe integer range.');
  }
  return Number(cents);
}
