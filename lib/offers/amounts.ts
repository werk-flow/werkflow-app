import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { draftAmounts, type DraftAmounts } from '@/lib/invoices/amounts';
import type { InvoiceLineValues } from '@/lib/invoices/types';
import { lineCostCents } from './calculation';
import type { OfferFreePosition, OfferPosition, OfferPositionType, OfferSection } from './types';

// The amounts of an offer come from the one invoice core, as an invoice's do,
// so an invoice of the same positions later agrees with the offer: each priced
// position by the shared line rule, VAT per rate on the sum of that rate's
// positions. A Titel's subtotal is the sum of its normal positions; a text
// line has no amount. A Bedarfs- or Alternativposition has its own amount by
// the same line rule, and no sum or VAT counts it. The editor shows them while the office types; the server
// computes them again from the parsed input and stores what it computed.

export type OfferAmounts = DraftAmounts & {
  /** Per Titel: its subtotal and each position's amount, `null` for a text line. */
  sections: Array<{ netCents: number; positionCents: Array<number | null> }>;
};

type PricedPosition = { kind: 'free'; positionType: OfferPositionType } & InvoiceLineValues;

/**
 * Titel as their amounts read them: each Position's kind and line values. A
 * Position's source and cost play no part, so a document's content, which
 * carries no cost, computes by the same rule as the editor's.
 */
type PricedSection = { positions: ReadonlyArray<{ kind: 'text' } | PricedPosition> };

/** Whether a position counts in its Titel's subtotal, the totals and the VAT: a normal priced one. */
export function countsInTotal(
  position: { kind: 'text' } | Pick<PricedPosition, 'kind' | 'positionType'>,
): boolean {
  return position.kind === 'free' && position.positionType.kind === 'normal';
}

/** Every amount of an offer's content. Throws a RangeError on a position the line rule refuses. */
export function offerAmounts<Section extends PricedSection>(sections: readonly Section[]): OfferAmounts {
  const priced = sections.flatMap((section) =>
    section.positions.flatMap((position) => (position.kind === 'free' ? [position] : [])),
  );
  const amounts = draftAmounts(priced.filter(countsInTotal));
  // Outside the sums each one still takes its amount by the line rule, rounded once, and
  // within its own line bound: no VAT basis sums them.
  const outsideCents = priced
    .filter((position) => !countsInTotal(position))
    .map((position) => draftAmounts([position]).lineNetCents[0])
    .reverse();
  const countedCents = [...amounts.lineNetCents].reverse();
  return {
    ...amounts,
    sections: sections.map((section) => {
      let netCents = 0;
      const positionCents = section.positions.map((position) => {
        if (position.kind === 'text') return null;
        const counts = countsInTotal(position);
        const cents = counts ? countedCents.pop() : outsideCents.pop();
        if (cents === undefined) throw new RangeError('A priced position has no computed amount.');
        if (counts) netCents += cents;
        return cents;
      });
      return { netCents, positionCents };
    }),
  };
}

type OfferContentArgument = {
  sections: Array<{
    title: string;
    netCents: number;
    positions: Array<OfferPosition | (OfferFreePosition & { unitLabel: string; amountCents: number })>;
  }>;
  totals: { netCents: number; taxCents: number; grossCents: number };
};

/**
 * The content as `save_offer_content` stores it: each priced position with its
 * unit's short label and its amount, each Titel with its subtotal, and the
 * totals. Null for a position the line rule refuses, and for an amount the
 * computation did not answer: nothing stores a guessed zero.
 */
export function offerContentArgument(sections: readonly OfferSection[]): OfferContentArgument | null {
  try {
    const amounts = offerAmounts(sections);
    // A line cost the calculation refuses is refused by the save too, so every saved offer calculates.
    for (const position of sections.flatMap((section) => section.positions)) {
      if (position.kind === 'free' && position.cost) lineCostCents(position.quantity, position.cost);
    }
    return {
      sections: sections.map((section, sectionIndex) => {
        const computed = amounts.sections[sectionIndex];
        if (!computed) throw new RangeError('A Titel has no computed subtotal.');
        return {
          title: section.title,
          netCents: computed.netCents,
          positions: section.positions.map((position, positionIndex) => {
            if (position.kind === 'text') return position;
            const amountCents = computed.positionCents[positionIndex];
            if (amountCents === null || amountCents === undefined) {
              throw new RangeError('A priced position has no computed amount.');
            }
            const unit = INVENTORY_UNITS.find((candidate) => candidate.code === position.unit);
            return { ...position, unitLabel: unit?.shortLabel ?? position.unit, amountCents };
          }),
        };
      }),
      totals: {
        netCents: amounts.totals.lineNetCents,
        taxCents: amounts.totals.taxCents,
        grossCents: amounts.totals.grossCents,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
