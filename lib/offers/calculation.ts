import { lineAmountCents, type PriceQuantity } from '@/lib/inventory/line-amount';
import type { OfferAmounts } from './amounts';
import type { OfferPositionCost, OfferSection } from './types';

// The office's calculation of an offer: what each Position costs, what it
// sells for and the margin between them, per Titel and for the offer. Office
// facts only: the editor shows them to Admin and Büro, and no document of the
// offer carries one. A Position's cost is its quantity at its own cost per
// price quantity, by the shared line rule, rounded once like its amount. The
// sale amount is the one the offer's totals count (lib/offers/amounts.ts).

/** One Position: its cost and margin are null while it has no cost. */
export type PositionFigures = {
  saleCents: number;
  costCents: number | null;
  marginCents: number | null;
  /** The margin in basis points of the sale amount; null without a cost or a sale amount. */
  marginBasisPoints: number | null;
};

/** A Titel or the offer. A Position without a cost adds its sale amount and no cost; `withoutCost` counts them. */
export type CalculationFigures = {
  saleCents: number;
  costCents: number;
  marginCents: number;
  marginBasisPoints: number | null;
  withoutCost: number;
};

export type OfferCalculation = {
  /** Per Titel, with each Position's figures, null for a text line. */
  sections: Array<CalculationFigures & { positions: Array<PositionFigures | null> }>;
  offer: CalculationFigures;
};

const BASIS = BigInt(10_000);
const ZERO = BigInt(0);
const TWO = BigInt(2);

/** `part` in basis points of `whole`, rounded half away from zero; null for a whole of zero. */
function basisPointsOf(part: number, whole: number): number | null {
  if (whole === 0) return null;
  const numerator = BigInt(part) * BASIS;
  const denominator = BigInt(whole);
  const negative = numerator < ZERO !== denominator < ZERO;
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const divisor = denominator < ZERO ? -denominator : denominator;
  const rounded = (magnitude * TWO + divisor) / (divisor * TWO);
  return Number(negative ? -rounded : rounded);
}

function figures(saleCents: number, costCents: number, withoutCost: number): CalculationFigures {
  const marginCents = saleCents - costCents;
  return {
    saleCents,
    costCents,
    marginCents,
    marginBasisPoints: basisPointsOf(marginCents, saleCents),
    withoutCost,
  };
}

function sum(groups: ReadonlyArray<CalculationFigures>): CalculationFigures {
  return figures(
    groups.reduce((total, group) => total + group.saleCents, 0),
    groups.reduce((total, group) => total + group.costCents, 0),
    groups.reduce((total, group) => total + group.withoutCost, 0),
  );
}

/** The calculation of the content whose amounts `amounts` holds (offerAmounts of the same sections). */
export function offerCalculation(sections: readonly OfferSection[], amounts: OfferAmounts): OfferCalculation {
  const calculated = sections.map((section, sectionIndex) => {
    const positionCents = amounts.sections[sectionIndex]?.positionCents ?? [];
    const positions = section.positions.map((position, positionIndex): PositionFigures | null => {
      if (position.kind === 'text') return null;
      const saleCents = positionCents[positionIndex];
      if (saleCents === null || saleCents === undefined) {
        throw new RangeError('A priced position has no computed amount.');
      }
      if (!position.cost) return { saleCents, costCents: null, marginCents: null, marginBasisPoints: null };
      const costCents = lineAmountCents(
        position.quantity,
        position.cost.amountCents,
        position.cost.priceQuantity,
      );
      const marginCents = saleCents - costCents;
      return { saleCents, costCents, marginCents, marginBasisPoints: basisPointsOf(marginCents, saleCents) };
    });
    const priced = positions.flatMap((position) => (position ? [position] : []));
    return {
      ...figures(
        priced.reduce((total, position) => total + position.saleCents, 0),
        priced.reduce((total, position) => total + (position.costCents ?? 0), 0),
        priced.filter((position) => position.costCents === null).length,
      ),
      positions,
    };
  });
  return { sections: calculated, offer: sum(calculated) };
}

/** The largest markup the editor takes, in tenths of a percent: 999,9 %. */
export const MAX_MARKUP_TENTHS = 9999;

/**
 * The net price per `priceQuantity` that puts a markup on a cost: the cost
 * per its own price quantity, scaled to the Position's, times one plus the
 * markup, rounded half away from zero once by the shared line rule. The
 * office can still change the price; the stored price is what counts.
 */
export function markupPriceCents(
  cost: OfferPositionCost,
  priceQuantity: PriceQuantity,
  markupTenths: number,
): number {
  if (!Number.isInteger(markupTenths) || markupTenths < 0 || markupTenths > MAX_MARKUP_TENTHS) {
    throw new RangeError('A markup is between 0 and 999,9 percent in tenths.');
  }
  // priceQuantity × (1 + markup) as a quantity in thousandths: 1 + 12,5 % is 1.125.
  const factor = { thousandths: BigInt(priceQuantity) * BigInt(1000 + markupTenths) };
  return lineAmountCents(factor, cost.amountCents, cost.priceQuantity);
}
