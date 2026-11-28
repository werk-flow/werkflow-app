import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  priceCentsArbitrary,
  priceQuantityArbitrary,
  quantityText,
  roundHalfAwayFromZero,
} from '@/lib/testing/invoice-arbitraries';
import { offerAmounts } from './amounts';
import { markupPriceCents, MAX_MARKUP_TENTHS, offerCalculation } from './calculation';
import type { OfferFreePosition, OfferPositionType, OfferSection } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "Offers": a Position's cost is its quantity at its own
// cost per price quantity, rounded once; its margin is its amount less its cost, in percent of its
// amount rounded once; a Titel and the offer sum their normal Positionen, counting the ones without a
// cost; a Bedarfs- or Alternativposition counts in no sum, total or VAT; a markup on the cost sets the
// price, rounded once.

const THOUSAND = BigInt(1000);

/** Quantities of up to 500 pieces, credits included, which keep every sum far inside the line bound. */
const thousandthsArbitrary = fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) });

/** Mostly normal Positions; an Alternativposition's Position plays no part in an amount. */
const positionTypeArbitrary: fc.Arbitrary<OfferPositionType> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ kind: 'normal' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'bedarf' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'alternative' as const, alternativeTo: 1 }) },
);

const positionArbitrary: fc.Arbitrary<OfferFreePosition> = fc
  .record({
    positionType: positionTypeArbitrary,
    thousandths: thousandthsArbitrary,
    unitPriceCents: priceCentsArbitrary,
    priceQuantity: priceQuantityArbitrary,
    taxRateBasisPoints: fc.constantFrom(1900, 700, 0),
    cost: fc.option(fc.record({ amountCents: priceCentsArbitrary, priceQuantity: priceQuantityArbitrary })),
  })
  .map(({ positionType, thousandths, unitPriceCents, priceQuantity, taxRateBasisPoints, cost }) => ({
    kind: 'free',
    positionType,
    name: 'Position',
    description: '',
    quantity: quantityText(thousandths),
    unit: 'piece',
    unitPriceCents,
    priceQuantity,
    taxRateBasisPoints,
    source: null,
    cost,
    priceSource: { kind: 'manuell' },
  }));

/** The rule, stated here on its own: only a normal Position counts in a sum. */
const isNormal = (position: OfferSection['positions'][number]): position is OfferFreePosition =>
  position.kind === 'free' && position.positionType.kind === 'normal';

const offerArbitrary: fc.Arbitrary<OfferSection[]> = fc.array(
  fc.record({ title: fc.constant('Titel'), positions: fc.array(positionArbitrary, { maxLength: 8 }) }),
  { minLength: 1, maxLength: 5 },
);

/** The exact cost of a Position: quantity × cost ÷ price quantity, rounded half away from zero once. */
function exactCost(position: OfferFreePosition): bigint | null {
  if (!position.cost) return null;
  const thousandths = BigInt(Math.round(Number(position.quantity) * 1000));
  return roundHalfAwayFromZero(
    thousandths * BigInt(position.cost.amountCents),
    BigInt(position.cost.priceQuantity) * THOUSAND,
  );
}

/** A margin in tenths of a percent of a sale amount, rounded once; null without a sale amount. */
function exactPermille(margin: bigint, sale: bigint): number | null {
  if (sale === BigInt(0)) return null;
  const negative = margin < BigInt(0) !== sale < BigInt(0);
  const rounded = roundHalfAwayFromZero(
    (margin < BigInt(0) ? -margin : margin) * THOUSAND,
    sale < BigInt(0) ? -sale : sale,
  );
  return Number(negative ? -rounded : rounded);
}

describe('An offer’s calculation', () => {
  test('costs each Position once by the line rule, and its margin is its amount less its cost', () => {
    fc.assert(
      fc.property(offerArbitrary, (sections) => {
        const amounts = offerAmounts(sections);
        const calculation = offerCalculation(sections, amounts);
        sections.forEach((section, sectionIndex) => {
          section.positions.forEach((position, positionIndex) => {
            const figures = calculation.sections[sectionIndex]?.positions[positionIndex];
            const sale = amounts.sections[sectionIndex]?.positionCents[positionIndex];
            if (position.kind === 'text' || !figures || sale === null || sale === undefined) return;
            const cost = exactCost(position);
            expect(figures.saleCents).toBe(sale);
            if (cost === null) {
              expect([figures.costCents, figures.marginCents, figures.marginPermille]).toEqual([
                null,
                null,
                null,
              ]);
              return;
            }
            const margin = BigInt(sale) - cost;
            expect(figures.costCents).toBe(Number(cost));
            expect(figures.marginCents).toBe(Number(margin));
            expect(figures.marginPermille).toBe(exactPermille(margin, BigInt(sale)));
          });
        });
      }),
    );
  });

  test('sums every Titel and the offer exactly, against the net total the VAT is computed on', () => {
    fc.assert(
      fc.property(offerArbitrary, (sections) => {
        const amounts = offerAmounts(sections);
        const calculation = offerCalculation(sections, amounts);
        const priced = sections.flatMap((section) =>
          section.positions.flatMap((p) => (isNormal(p) ? [p] : [])),
        );
        const cost = priced.reduce(
          (total, position) => total + (exactCost(position) ?? BigInt(0)),
          BigInt(0),
        );
        const sale = BigInt(amounts.totals.lineNetCents);
        expect(calculation.offer).toEqual({
          saleCents: Number(sale),
          costCents: Number(cost),
          marginCents: Number(sale - cost),
          marginPermille: exactPermille(sale - cost, sale),
          withoutCost: priced.filter((position) => !position.cost).length,
        });
        expect(calculation.sections.map((section) => section.saleCents)).toEqual(
          amounts.sections.map((section) => section.netCents),
        );
      }),
    );
  });

  test('leaves each Bedarfs- and Alternativposition out of every sum, total and VAT, at its own line amount', () => {
    fc.assert(
      fc.property(offerArbitrary, (sections) => {
        const amounts = offerAmounts(sections);
        const counted = sections.map((section) => ({
          ...section,
          positions: section.positions.filter(isNormal),
        }));
        const without = offerAmounts(counted);
        expect(amounts.totals).toEqual(without.totals);
        expect(amounts.taxSubtotals).toEqual(without.taxSubtotals);
        expect(amounts.sections.map((section) => section.netCents)).toEqual(
          without.sections.map((section) => section.netCents),
        );
        sections.forEach((section, sectionIndex) => {
          section.positions.forEach((position, positionIndex) => {
            if (position.kind === 'text' || position.positionType.kind === 'normal') return;
            const thousandths = BigInt(Math.round(Number(position.quantity) * 1000));
            const exact = roundHalfAwayFromZero(
              thousandths * BigInt(position.unitPriceCents),
              BigInt(position.priceQuantity) * THOUSAND,
            );
            expect(amounts.sections[sectionIndex]?.positionCents[positionIndex]).toBe(Number(exact));
          });
        });
        expect(offerCalculation(sections, amounts).outsideTotal).toBe(
          sections.flatMap((section) => section.positions).filter((position) => !isNormal(position)).length,
        );
      }),
    );
  });
});

describe('A markup on a cost', () => {
  const markupArbitrary = fc.integer({ min: 0, max: MAX_MARKUP_TENTHS });
  const costArbitrary = fc.record({
    amountCents: priceCentsArbitrary,
    priceQuantity: priceQuantityArbitrary,
  });

  test('sets the price per the Position’s price quantity, rounded once', () => {
    fc.assert(
      fc.property(costArbitrary, priceQuantityArbitrary, markupArbitrary, (cost, priceQuantity, tenths) => {
        const exact = roundHalfAwayFromZero(
          BigInt(cost.amountCents) * BigInt(priceQuantity) * BigInt(1000 + tenths),
          BigInt(cost.priceQuantity) * THOUSAND,
        );
        expect(markupPriceCents(cost, priceQuantity, tenths)).toBe(Number(exact));
      }),
    );
  });

  test('never lowers the price when the markup rises', () => {
    fc.assert(
      fc.property(
        costArbitrary,
        priceQuantityArbitrary,
        markupArbitrary,
        markupArbitrary,
        (cost, pq, a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          expect(markupPriceCents(cost, pq, low)).toBeLessThanOrEqual(markupPriceCents(cost, pq, high));
        },
      ),
    );
  });
});
