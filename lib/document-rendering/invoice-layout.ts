import { addLocalDays } from '@/lib/date-time/berlin';
import { taxRateBasisPoints } from '@/lib/invoicing/calculate';
import type { CalculatedInvoice } from '@/lib/invoicing/model';
import { formatGermanDate, formatGermanDateRange } from '@/lib/utils';

import { formatTaxRate } from './format';
import type { BusinessDocument } from './model';

// The invoice layout: a calculated invoice of the invoice core as the
// renderer's plain document, with the company's letterhead. It prints what
// the embedded XML says and computes nothing: every amount comes from
// `calculateInvoice`. Texts are the invoice's own (notes, exemption reasons);
// the layout adds only labels, dates and the payment terms in words.

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

/** Short German labels of the UN/ECE Recommendation 20 codes WerkFlow writes; another code prints as is. */
const UNIT_LABELS: Record<string, string> = {
  C62: 'Stk',
  H87: 'Stk',
  HUR: 'Std',
  MIN: 'Min',
  DAY: 'Tag',
  MTR: 'm',
  MTK: 'm²',
  MTQ: 'm³',
  KMT: 'km',
  LTR: 'l',
  KGM: 'kg',
  LS: 'psch',
  SET: 'Satz',
  PR: 'Paar',
};

function addressLines(address: CalculatedInvoice['buyer']['address']): string[] {
  return [
    ...address.lines,
    `${address.postalCode} ${address.city}`,
    ...(address.countryCode === 'DE' ? [] : [address.countryCode]),
  ];
}

/** `DE00111111111111111111` → `DE00 1111 1111 1111 1111 11`. */
function groupedIban(iban: string): string {
  return iban.replaceAll(/(.{4})(?=.)/g, '$1 ');
}

function metaRowsOf(invoice: CalculatedInvoice): BusinessDocument['metaRows'] {
  const { delivery, seller, precedingInvoice, deliverTo } = invoice;
  return [
    { label: 'Rechnungsnummer', value: invoice.number },
    { label: 'Rechnungsdatum', value: formatGermanDate(invoice.issueDate) },
    delivery.kind === 'date'
      ? { label: 'Leistungsdatum', value: formatGermanDate(delivery.date) }
      : { label: 'Leistungszeitraum', value: formatGermanDateRange(delivery.start, delivery.end) },
    ...(precedingInvoice
      ? [
          {
            label: 'Storno zu',
            value: `Rechnung ${precedingInvoice.number} vom ${formatGermanDate(precedingInvoice.issueDate)}`,
          },
        ]
      : []),
    ...(invoice.orderReference ? [{ label: 'Bestellnummer', value: invoice.orderReference }] : []),
    ...(invoice.buyerReference ? [{ label: 'Referenz', value: invoice.buyerReference }] : []),
    ...(deliverTo
      ? [{ label: 'Leistungsort', value: [deliverTo.name, ...addressLines(deliverTo.address)].join(', ') }]
      : []),
    seller.vatId
      ? { label: 'USt-IdNr.', value: seller.vatId }
      : { label: 'Steuernummer', value: seller.taxNumber ?? '' },
  ];
}

/** Exemption reasons, Zahlungsziel, Skonto and Bankverbindung, one paragraph each. */
function closingTextOf(invoice: CalculatedInvoice): string {
  const reasons = invoice.taxSubtotals.flatMap(({ tax }) =>
    tax.category === 'E' ? [tax.exemptionReason] : [],
  );
  const { paymentTerms, payee } = invoice;
  const owed = invoice.totals.grossCents > 0;
  const terms = owed
    ? [
        `Zahlbar ohne Abzug bis ${formatGermanDate(invoice.dueDate)}.`,
        ...(paymentTerms.discount
          ? [
              `Bei Zahlung bis ${formatGermanDate(addLocalDays(invoice.issueDate, paymentTerms.discount.days))} ${formatTaxRate(paymentTerms.discount.percentBasisPoints)} Skonto.`,
            ]
          : []),
      ]
    : [];
  const account = payee && [
    payee.accountName && `Kontoinhaber ${payee.accountName}`,
    `IBAN ${groupedIban(payee.iban)}`,
    payee.bic && `BIC ${payee.bic}`,
  ];
  const bank = owed && account ? [`Bankverbindung: ${account.filter(Boolean).join(', ')}`] : [];
  return [...new Set(reasons), terms.join(' '), ...bank].filter(Boolean).join('\n\n');
}

/** A calculated invoice as the business document the renderer draws. */
export function invoiceDocument(invoice: CalculatedInvoice, letterhead: Letterhead): BusinessDocument {
  const title = invoice.typeCode === '384' ? 'Stornorechnung' : 'Rechnung';
  return {
    issuedOn: invoice.issueDate,
    sender: letterhead.sender,
    recipientLines: [invoice.buyer.name, ...addressLines(invoice.buyer.address)],
    title: `${title} ${invoice.number}`,
    metaRows: metaRowsOf(invoice),
    openingText: invoice.notes.join('\n'),
    sections: [
      {
        number: '',
        title: 'Leistungen',
        positions: invoice.lines.map((line) => ({
          number: line.id,
          text: line.name,
          description: line.description,
          quantity: line.quantity,
          unitLabel: UNIT_LABELS[line.unitCode] ?? line.unitCode,
          unitPriceCents: line.unitPriceCents,
          priceQuantity: line.priceQuantity,
          amountCents: line.netCents,
          kind: 'standard',
        })),
        subtotalCents: invoice.totals.lineNetCents,
      },
    ],
    totals: {
      byRate: invoice.taxSubtotals.map(({ tax, basisCents, taxCents }) => ({
        rateBasisPoints: taxRateBasisPoints(tax),
        ...(tax.category === 'E' ? { label: 'steuerfrei' } : {}),
        netCents: basisCents,
        vatCents: taxCents,
        grossCents: basisCents + taxCents,
      })),
      netCents: invoice.totals.lineNetCents,
      vatCents: invoice.totals.taxCents,
      grossCents: invoice.totals.grossCents,
    },
    closingText: closingTextOf(invoice),
    footerColumns: letterhead.footerColumns,
    stationery: letterhead.stationery,
  };
}
