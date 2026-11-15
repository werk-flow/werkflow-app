// Broken copies of the reference invoices. The EN 16931 check must refuse each
// with the named rule and model field. A copy breaks either the model, which
// the core then calculates and writes faithfully, or the written XML.

import type { InvoiceDraft } from '../model';

type InvoiceLine = InvoiceDraft['lines'][number];
import {
  CARD_INVOICE,
  EXEMPT_INVOICE,
  MIXED_RATE_INVOICE,
  STANDARD_RATE_INVOICE,
} from './reference-invoices';

type BrokenInvoice = {
  case: string;
  draft: InvoiceDraft;
  /** Changes the written XML; without it the model alone is broken. */
  tamper?: (xml: string) => string;
  expected: { ruleId: string; field: string };
};

const withLine = (draft: InvoiceDraft, index: number, change: Partial<InvoiceLine>): InvoiceDraft => ({
  ...draft,
  lines: draft.lines.map((line, at) => (at === index ? { ...line, ...change } : line)),
});

export const BROKEN_INVOICES: BrokenInvoice[] = [
  {
    case: 'a card payment that shows the full card number',
    draft: { ...CARD_INVOICE, payment: { kind: 'card', lastFour: '4242424242424242' } },
    expected: { ruleId: 'BR-51', field: 'payment.lastFour' },
  },
  {
    case: 'an amount due that is not the gross minus the paid amount',
    draft: CARD_INVOICE,
    tamper: (xml) =>
      xml.replace(
        '<ram:DuePayableAmount>0.00</ram:DuePayableAmount>',
        '<ram:DuePayableAmount>499.00</ram:DuePayableAmount>',
      ),
    expected: { ruleId: 'BR-CO-16', field: 'totals' },
  },
  {
    case: 'a seller with neither USt-IdNr. nor Steuernummer charges VAT',
    draft: { ...MIXED_RATE_INVOICE, seller: { ...MIXED_RATE_INVOICE.seller, vatId: null, taxNumber: null } },
    expected: { ruleId: 'BR-S-02', field: 'seller.vatId' },
  },
  {
    case: 'a seller without USt-IdNr. or Handelsregisternummer cannot be identified',
    draft: { ...EXEMPT_INVOICE, seller: { ...EXEMPT_INVOICE.seller, legalRegistrationId: null } },
    expected: { ruleId: 'BR-CO-26', field: 'seller.vatId' },
  },
  {
    case: 'a seller identifier with the scheme SEPA, which only UBL accepts',
    draft: {
      ...CARD_INVOICE,
      seller: { ...CARD_INVOICE.seller, identifier: { id: 'DE98ZZZ09999999999', scheme: 'SEPA' } },
    },
    expected: { ruleId: 'BR-CL-10', field: 'seller.identifier' },
  },
  {
    case: 'a buyer without a name',
    draft: { ...MIXED_RATE_INVOICE, buyer: { ...MIXED_RATE_INVOICE.buyer, name: '' } },
    expected: { ruleId: 'BR-07', field: 'buyer.name' },
  },
  {
    case: 'a negative net price',
    draft: withLine(MIXED_RATE_INVOICE, 1, { unitPriceCents: -3990 }),
    expected: { ruleId: 'BR-27', field: 'lines[1].unitPriceCents' },
  },
  {
    case: 'a unit code outside UN/ECE Recommendation 20',
    draft: withLine(MIXED_RATE_INVOICE, 2, { unitCode: 'Stk' }),
    expected: { ruleId: 'BR-CL-23', field: 'lines[2].unitCode' },
  },
  {
    case: 'an exemption without its reason',
    draft: withLine(EXEMPT_INVOICE, 0, { tax: { category: 'E', exemptionReason: '' } }),
    expected: { ruleId: 'BR-E-10', field: 'taxSubtotals[0]' },
  },
  {
    case: 'a buyer country that is no ISO 3166 code',
    draft: {
      ...MIXED_RATE_INVOICE,
      buyer: {
        ...MIXED_RATE_INVOICE.buyer,
        address: { ...MIXED_RATE_INVOICE.buyer.address, countryCode: 'XX' },
      },
    },
    expected: { ruleId: 'BR-CL-14', field: 'buyer.address' },
  },
  {
    case: 'a grand total that is not net plus VAT',
    draft: STANDARD_RATE_INVOICE,
    tamper: (xml) => xml.replace(/<ram:GrandTotalAmount>[^<]*</, '<ram:GrandTotalAmount>281.45<'),
    expected: { ruleId: 'BR-CO-15', field: 'totals' },
  },
  {
    case: 'an invoice without its issue date',
    draft: MIXED_RATE_INVOICE,
    tamper: (xml) => xml.replace(/<ram:IssueDateTime>[\s\S]*?<\/ram:IssueDateTime>/, ''),
    expected: { ruleId: 'BR-03', field: 'issueDate' },
  },
  {
    case: 'a seller without a postal address',
    draft: MIXED_RATE_INVOICE,
    tamper: (xml) => xml.replace(/<ram:PostalTradeAddress>[\s\S]*?<\/ram:PostalTradeAddress>/, ''),
    expected: { ruleId: 'BR-08', field: 'seller.address' },
  },
  {
    case: 'a VAT amount that is not the rate of its basis',
    draft: MIXED_RATE_INVOICE,
    tamper: (xml) => xml.replace('<ram:CalculatedAmount>36.66<', '<ram:CalculatedAmount>40.00<'),
    expected: { ruleId: 'BR-S-09', field: 'taxSubtotals[0]' },
  },
  {
    case: 'a line total that does not sum to the invoice net',
    draft: MIXED_RATE_INVOICE,
    tamper: (xml) => xml.replace('<ram:LineTotalAmount>232.86<', '<ram:LineTotalAmount>232.87<'),
    expected: { ruleId: 'BR-CO-10', field: 'totals' },
  },
];
