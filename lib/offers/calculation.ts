import { lineAmountCents, type PriceQuantity } from '@/lib/inventory/line-amount';
import { MAX_LINE_NET_CENTS } from '@/lib/invoices/amounts';
import { countsInTotal, exactCentsSum, type OfferAmounts } from './amounts';
import type { OfferPositionCost, OfferSection } from './types';

// The office's calculation of an offer: what each Position costs, what it
// sells for and the margin between them, per Titel and for the offer. Office
// facts only: the editor shows them to Admin and Büro, and no document of the
// offer carries one. A Position's cost is its quantity at its own cost per
// price quantity, by the shared line rule, rounded once like its amount, and
// within the same ten billion euros, so every sum stays an exact integer. The
// sale amount is the one the offer's totals count (lib/offers/amounts.ts). A
// Bedarfs- or Alternativposition has its own figures, and no Titel or offer
// sum counts it, as no total does. A Nachlass or Zuschlag changes the sale
// amount and the margin of its Titel and the offer by its amount and has no
// cost: costs never change with one.

/** One Position: its cost and margin are null while it has no cost. */
export type PositionFigures = {
  saleCents: number;
  costCents: number | null;
  marginCents: number | null;
  /** The margin in tenths of a percent of the sale amount, rounded once; null without a cost or a sale amount. */
  marginPermille: number | null;
};

/**
 * A Titel or the offer. A Position without a cost adds its sale amount and no
 * cost; `withoutCost` counts them. `adjustmentCents` is what its Nachlässe and
 * Zuschläge add to the sale amount and the margin, negative for a Nachlass.
 */
export type CalculationFigures = {
  saleCents: number;
  costCents: number;
  marginCents: number;
  marginPermille: number | null;
  withoutCost: number;
  adjustmentCents: number;
};

export type OfferCalculation = {
  /** Per Titel, with each Position's figures, null for a text line. */
  sections: Array<CalculationFigures & { positions: Array<PositionFigures | null> }>;
  offer: CalculationFigures;
  /** How many Bedarfs- and Alternativpositionen the sums leave out. */
  outsideTotal: number;
};

const PER_MILLE = BigInt(1000);
const ZERO = BigInt(0);
const TWO = BigInt(2);

/** `part` in tenths of a percent of `whole`, rounded half away from zero; null for a whole of zero. */
function permilleOf(part: number, whole: number): number | null {
  if (whole === 0) return null;
  const numerator = BigInt(part) * PER_MILLE;
  const denominator = BigInt(whole);
  const negative = numerator < ZERO !== denominator < ZERO;
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const divisor = denominator < ZERO ? -denominator : denominator;
  const rounded = (magnitude * TWO + divisor) / (divisor * TWO);
  return Number(negative ? -rounded : rounded);
}

type Sums = Pick<CalculationFigures, 'saleCents' | 'costCents' | 'withoutCost' | 'adjustmentCents'>;

function figures(sums: Sums): CalculationFigures {
  const marginCents = sums.saleCents - sums.costCents;
  return { ...sums, marginCents, marginPermille: permilleOf(marginCents, sums.saleCents) };
}

/** The exact sums of `groups`, as the offer's totals add (exactCentsSum). */
function sum(groups: ReadonlyArray<Sums>): Sums {
  return {
    saleCents: exactCentsSum(groups.map((group) => group.saleCents)),
    costCents: exactCentsSum(groups.map((group) => group.costCents)),
    withoutCost: groups.reduce((total, group) => total + group.withoutCost, 0),
    adjustmentCents: exactCentsSum(groups.map((group) => group.adjustmentCents)),
  };
}

/**
 * The largest cost per price quantity a Position keeps: any article price may
 * stand in the cost store (a wholesaler import takes up to 2^31 cents), so the
 * only bound is the line's.
 */
export const MAX_COST_CENTS = MAX_LINE_NET_CENTS;

/**
 * A Position's cost: its quantity at its cost per price quantity, by the
 * shared line rule. Throws a RangeError beyond ten billion euros, the bound
 * of a line amount, which keeps every sum of an offer an exact integer.
 */
export function lineCostCents(quantity: string, cost: OfferPositionCost): number {
  const cents = lineAmountCents(quantity, cost.amountCents, cost.priceQuantity);
  if (Math.abs(cents) > MAX_LINE_NET_CENTS) throw new RangeError('A line cost exceeds ten billion euros.');
  return cents;
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
      if (position.kind === 'adjustment' || !position.cost) {
        return { saleCents, costCents: null, marginCents: null, marginPermille: null };
      }
      const costCents = lineCostCents(position.quantity, position.cost);
      const marginCents = saleCents - costCents;
      return { saleCents, costCents, marginCents, marginPermille: permilleOf(marginCents, saleCents) };
    });
    const counted = section.positions.flatMap((position, index): Sums[] => {
      const line = positions[index];
      if (!line || position.kind === 'text' || !countsInTotal(position)) return [];
      const adjustment = position.kind === 'adjustment';
      return [
        {
          saleCents: line.saleCents,
          costCents: line.costCents ?? 0,
          withoutCost: !adjustment && line.costCents === null ? 1 : 0,
          adjustmentCents: adjustment ? line.saleCents : 0,
        },
      ];
    });
    return { ...figures(sum(counted)), positions };
  });
  const outsideTotal = sections
    .flatMap((section) => section.positions)
    .filter((position) => position.kind === 'free' && !countsInTotal(position)).length;
  return { sections: calculated, offer: figures(sum(calculated)), outsideTotal };
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
