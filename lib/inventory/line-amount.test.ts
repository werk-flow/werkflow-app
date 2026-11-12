import { describe, expect, test } from 'bun:test';
import { type LineQuantity, lineAmountCents, type PriceQuantity } from './line-amount';

// The one table of cases for the line arithmetic rule: quantity × amount ÷
// price quantity, rounded half away from zero to the cent once. A later SQL
// twin of the rule must pass this same table.
const LINE_AMOUNT_CASES: ReadonlyArray<{
  case: string;
  quantity: LineQuantity;
  amountCents: number;
  priceQuantity: PriceQuantity;
  expected: number;
}> = [
  {
    case: '0,125 m at 12,34 € per 100 m',
    quantity: '0.125',
    amountCents: 1234,
    priceQuantity: 100,
    expected: 2,
  },
  {
    case: 'the same as thousandths',
    quantity: { thousandths: BigInt(125) },
    amountCents: 1234,
    priceQuantity: 100,
    expected: 2,
  },
  { case: 'a half cent rounds up', quantity: '0.5', amountCents: 1, priceQuantity: 1, expected: 1 },
  {
    case: 'a half cent below zero rounds down',
    quantity: '-0.5',
    amountCents: 1,
    priceQuantity: 1,
    expected: -1,
  },
  {
    case: 'a tie on an even cent still rounds away',
    quantity: '2.5',
    amountCents: 1,
    priceQuantity: 1,
    expected: 3,
  },
  {
    case: 'a half cent from a price per 1000',
    quantity: '500',
    amountCents: 1,
    priceQuantity: 1000,
    expected: 1,
  },
  { case: 'just under a half cent', quantity: '499.999', amountCents: 1, priceQuantity: 1000, expected: 0 },
  { case: 'a negative price per 10', quantity: '2', amountCents: -333, priceQuantity: 10, expected: -67 },
  { case: 'a negative quantity', quantity: '-0.125', amountCents: 1234, priceQuantity: 100, expected: -2 },
  { case: 'zero', quantity: '0', amountCents: 1234, priceQuantity: 1, expected: 0 },
  {
    case: 'the largest quantity numeric(12,3) takes',
    quantity: '999999999.999',
    amountCents: 1234,
    priceQuantity: 100,
    expected: 12_340_000_000,
  },
  {
    case: 'a sum a float product gets wrong (0.1 × 3 × 10,05 €)',
    quantity: '0.3',
    amountCents: 1005,
    priceQuantity: 1,
    expected: 302,
  },
];

describe('lineAmountCents', () => {
  for (const row of LINE_AMOUNT_CASES) {
    test(row.case, () => {
      expect(lineAmountCents(row.quantity, row.amountCents, row.priceQuantity)).toBe(row.expected);
    });
  }

  test('refuses a quantity it cannot read exactly instead of guessing', () => {
    for (const quantity of ['0.1234', '1e3', '1,5', '', ' 1', '1000000000']) {
      expect(() => lineAmountCents(quantity, 100, 1), quantity).toThrow(RangeError);
    }
  });

  test('refuses a fractional cent amount and a result past the safe integer range', () => {
    expect(() => lineAmountCents('1', 1.5, 1)).toThrow(RangeError);
    expect(() => lineAmountCents('999999999.999', Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});
