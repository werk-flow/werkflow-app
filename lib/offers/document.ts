import type {
  BusinessDocument,
  DocumentPosition,
  DocumentTextLine,
  DocumentTotals,
} from '@/lib/document-rendering/model';
import { unitShortLabelOrStored } from '@/lib/inventory/article-terms-format';
import { taxRateBasisPoints } from '@/lib/invoicing/calculate';
import { formatGermanDate } from '@/lib/utils';
import { offerAmounts } from './amounts';
import { positionNumbers } from './numbering';
import type { OfferDetail } from './types';

// An offer as the PDF its customer gets, mapped into the renderer's plain
// model. The preview and the sent revision both render through this one
// mapping, with the amounts of the one offer rule, so what the office sees is
// what is stored. A Bedarfs- or Alternativposition prints its amount in
// parentheses, outside the sums; an Alternativposition names its Position and
// the difference.

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

/** The offer facts the PDF prints. */
export type PrintedOffer = Pick<
  OfferDetail,
  'offerNumber' | 'title' | 'validUntil' | 'openingText' | 'closingText' | 'client' | 'site' | 'sections'
> & { recipient: { id: string; name: string; address: string | null } };

/** The lines of an address text, such as „Hofweg 1, 10117 Berlin“, also written over several lines. */
function addressTextLines(address: string | null): string[] {
  return (address ?? '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function priced(amountCents: number | null | undefined): number {
  if (amountCents === null || amountCents === undefined) {
    throw new RangeError('A priced position has no computed amount.');
  }
  return amountCents;
}

/**
 * Revision `revision` of the offer, dated `issuedOn`: the number with the
 * revision beside it, the Rechnungsempfänger as addressee, the customer when
 * someone else receives the offer, and the Einsatzort. Throws a RangeError on
 * a Position the line rule refuses.
 */
export function offerDocument(
  offer: PrintedOffer,
  letterhead: Letterhead,
  sending: { issuedOn: string; revision: number },
): BusinessDocument & { totals: DocumentTotals } {
  const amounts = offerAmounts(offer.sections);
  return {
    issuedOn: sending.issuedOn,
    ...letterhead,
    recipientLines: [offer.recipient.name, ...addressTextLines(offer.recipient.address)],
    title: `Angebot: ${offer.title}`,
    metaRows: [
      { label: 'Angebot', value: `${offer.offerNumber}, Revision ${sending.revision}` },
      { label: 'Datum', value: formatGermanDate(sending.issuedOn) },
      { label: 'Gültig bis', value: formatGermanDate(offer.validUntil) },
      ...(offer.recipient.id === offer.client.id ? [] : [{ label: 'Kunde', value: offer.client.name }]),
      ...(offer.site ? [{ label: 'Objekt', value: offer.site.address || offer.site.name }] : []),
    ],
    openingText: offer.openingText,
    sections: offer.sections.map((section, sectionIndex) => {
      const number = String(sectionIndex + 1);
      const numbers = positionNumbers(number, section.positions);
      const computed = amounts.sections[sectionIndex];
      if (!computed) throw new RangeError('A Titel has no computed subtotal.');
      return {
        number,
        title: section.title,
        subtotalCents: computed.netCents,
        positions: section.positions.map((position, index): DocumentPosition | DocumentTextLine => {
          if (position.kind === 'text') {
            return { kind: 'text', text: position.name, description: position.description };
          }
          const amountCents = priced(computed.positionCents[index]);
          const printed = {
            number: numbers[index] ?? '',
            text: position.name,
            description: position.description,
            quantity: position.quantity,
            unitLabel: unitShortLabelOrStored(position.unit),
            unitPriceCents: position.unitPriceCents,
            priceQuantity: position.priceQuantity,
            amountCents,
          };
          const type = position.positionType;
          if (type.kind === 'normal') return { kind: 'standard', ...printed };
          if (type.kind === 'bedarf') return { kind: 'bedarf', ...printed };
          // Its Position is a normal priced one of the same Titel (action-schemas.ts, the database's key).
          const base = type.alternativeTo - 1;
          return {
            kind: 'alternative',
            ...printed,
            alternativeTo: {
              number: numbers[base] ?? '',
              differenceCents: amountCents - priced(computed.positionCents[base]),
            },
          };
        }),
      };
    }),
    totals: {
      byRate: amounts.taxSubtotals.map(({ tax, basisCents, taxCents }) => ({
        rateBasisPoints: taxRateBasisPoints(tax),
        netCents: basisCents,
        vatCents: taxCents,
        grossCents: basisCents + taxCents,
      })),
      netCents: amounts.totals.lineNetCents,
      vatCents: amounts.totals.taxCents,
      grossCents: amounts.totals.grossCents,
    },
    closingText: offer.closingText,
  };
}
