import { describe, expect, test } from 'bun:test';
import { offerAmounts } from './amounts';
import { markupPriceCents, offerCalculation } from './calculation';
import type { OfferFreePosition, OfferSection } from './types';

function free(
  quantity: string,
  unitPriceCents: number,
  cost: OfferFreePosition['cost'],
  options: Partial<Pick<OfferFreePosition, 'priceQuantity' | 'taxRateBasisPoints'>> = {},
): OfferFreePosition {
  return {
    kind: 'free',
    name: 'Position',
    description: '',
    quantity,
    unit: 'piece',
    unitPriceCents,
    priceQuantity: options.priceQuantity ?? 1,
    taxRateBasisPoints: options.taxRateBasisPoints ?? 1900,
    source: null,
    cost,
  };
}

// The table of cases of an offer's calculation: each Position's cost by the
// shared line rule on its own price quantity, its margin against the amount
// the offer's totals count, and per Titel and offer the sums of both, with
// the margin in percent of the sale amount.
const OFFER: OfferSection[] = [
  {
    title: 'Heizung',
    positions: [
      // 19 %: 4.250,00 € sale, 3.100,00 € cost.
      free('1', 425_000, { amountCents: 310_000, priceQuantity: 1 }),
      // 7 % in the same Titel: 29,95 € sale, 12,00 € cost.
      free('1', 2995, { amountCents: 1200, priceQuantity: 1 }, { taxRateBasisPoints: 700 }),
      // Three decimals, a cost per 10 beside a sale price per 1:
      // 2,125 m × 12,49 € = 26,54 €; 2,125 × 81,20 € ÷ 10 = 17,255 € → 17,26 €.
      free('2.125', 1249, { amountCents: 8120, priceQuantity: 10 }),
      // A price per 100 with a cost per 100: 250 × 18,90 € ÷ 100 = 47,25 €; 250 × 9,99 € ÷ 100 = 24,975 € → 24,98 €.
      free('250', 1890, { amountCents: 999, priceQuantity: 100 }, { priceQuantity: 100 }),
      { kind: 'text', name: 'Hinweis', description: '' },
    ],
  },
  {
    title: 'Nachlass',
    positions: [
      // A negative line with a cost: a returned part credits 150,00 € and 90,00 € cost.
      free('-1', 15_000, { amountCents: 9000, priceQuantity: 1 }),
      // Without a cost: its sale counts, its cost is unknown.
      free('1', 5000, null),
    ],
  },
];

describe('offerCalculation', () => {
  const calculation = offerCalculation(OFFER, offerAmounts(OFFER));

  test('a Position costs its quantity at its own cost per price quantity, rounded once', () => {
    expect(calculation.sections[0]?.positions).toEqual([
      { saleCents: 425_000, costCents: 310_000, marginCents: 115_000, marginBasisPoints: 2706 },
      { saleCents: 2995, costCents: 1200, marginCents: 1795, marginBasisPoints: 5993 },
      { saleCents: 2654, costCents: 1726, marginCents: 928, marginBasisPoints: 3497 },
      { saleCents: 4725, costCents: 2498, marginCents: 2227, marginBasisPoints: 4713 },
      null,
    ]);
  });

  test('a negative line credits its cost too, and a Position without a cost has no margin', () => {
    expect(calculation.sections[1]?.positions).toEqual([
      { saleCents: -15_000, costCents: -9000, marginCents: -6000, marginBasisPoints: 4000 },
      { saleCents: 5000, costCents: null, marginCents: null, marginBasisPoints: null },
    ]);
  });

  test('a Titel sums both tax rates and counts its Positions without a cost', () => {
    expect(calculation.sections[0]).toMatchObject({
      saleCents: 435_374,
      costCents: 315_424,
      marginCents: 119_950,
      marginBasisPoints: 2755,
      withoutCost: 0,
    });
    expect(calculation.sections[1]).toMatchObject({
      saleCents: -10_000,
      costCents: -9000,
      marginCents: -1000,
      marginBasisPoints: 1000,
      withoutCost: 1,
    });
  });

  test('the offer sums every Titel against the net total its VAT is computed on', () => {
    expect(calculation.offer).toEqual({
      saleCents: 425_374,
      costCents: 306_424,
      marginCents: 118_950,
      marginBasisPoints: 2796,
      withoutCost: 1,
    });
    expect(calculation.offer.saleCents).toBe(offerAmounts(OFFER).totals.lineNetCents);
  });

  test('a sale amount of zero has no margin in percent', () => {
    const empty = offerCalculation([{ title: 'Leer', positions: [] }], offerAmounts([]));
    expect(empty.offer).toEqual({
      saleCents: 0,
      costCents: 0,
      marginCents: 0,
      marginBasisPoints: null,
      withoutCost: 0,
    });
  });
});

describe('markupPriceCents', () => {
  test.each([
    // cost per price quantity, the Position's price quantity, markup in tenths of a percent, price
    ['12,5 % on 1,99 €: 2,23875 € rounds to 2,24 €', { amountCents: 199, priceQuantity: 1 }, 1, 125, 224],
    ['10 % on 0,05 €: 0,055 € rounds half away from zero', { amountCents: 5, priceQuantity: 1 }, 1, 100, 6],
    ['no markup keeps the cost', { amountCents: 4999, priceQuantity: 1 }, 1, 0, 4999],
    ['25 % on 81,20 € per 10, sold per 1: 10,15 €', { amountCents: 8120, priceQuantity: 10 }, 1, 250, 1015],
    [
      '33,3 % on 0,19 € per 1, sold per 100: 25,327 € → 25,33 €',
      { amountCents: 19, priceQuantity: 1 },
      100,
      333,
      2533,
    ],
    ['999,9 % on 1.000,00 €', { amountCents: 100_000, priceQuantity: 1 }, 1, 9999, 1_099_900],
  ] as const)('%s', (_case, cost, priceQuantity, markupTenths, price) => {
    expect(markupPriceCents(cost, priceQuantity, markupTenths)).toBe(price);
  });
});
