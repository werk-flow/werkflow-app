import { draftAmounts, type DraftAmounts } from '@/lib/invoices/amounts';
import type { OfferSection } from './types';

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
