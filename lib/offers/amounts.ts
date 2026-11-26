import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { draftAmounts, type DraftAmounts } from '@/lib/invoices/amounts';
import type { OfferFreePosition, OfferPosition, OfferSection } from './types';

// The amounts of an offer come from the one invoice core, as an invoice's do,
// so an invoice of the same positions later agrees with the offer: each priced
// position by the shared line rule, VAT per rate on the sum of that rate's
// positions. A Titel's subtotal is the sum of its positions; a text line has
// no amount. The editor shows them while the office types; the server
// computes them again from the parsed input and stores what it computed.

export type OfferAmounts = DraftAmounts & {
  /** Per Titel: its subtotal and each position's amount, `null` for a text line. */
  sections: Array<{ netCents: number; positionCents: Array<number | null> }>;
};

/** Every amount of an offer's content. Throws a RangeError on a position the line rule refuses. */
export function offerAmounts(sections: readonly OfferSection[]): OfferAmounts {
  const priced = sections.flatMap((section) =>
    section.positions.flatMap((position) => (position.kind === 'free' ? [position] : [])),
  );
  const amounts = draftAmounts(priced);
  const lineCents = [...amounts.lineNetCents].reverse();
  return {
    ...amounts,
    sections: sections.map((section) => {
      const positionCents = section.positions.map((position) =>
        position.kind === 'free' ? (lineCents.pop() ?? 0) : null,
      );
      return { netCents: positionCents.reduce<number>((sum, cents) => sum + (cents ?? 0), 0), positionCents };
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
