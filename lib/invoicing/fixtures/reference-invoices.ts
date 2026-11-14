// Reference invoices of the invoice core: made-up companies, people, prices
// and identifiers only. Every one must pass the EN 16931 rules; every broken
// copy must be refused with the rule and the model field at fault.

import type { InvoiceDraft, InvoiceLine, InvoiceSeller, InvoiceTax } from '../model';

const seller: InvoiceSeller = {
  name: 'Haustechnik Sonnenberg GmbH',
  address: { lines: ['Sonnenweg 1'], postalCode: '01234', city: 'Sonnenstadt', countryCode: 'DE' },
  vatId: 'DE123456789',
  taxNumber: null,
  legalRegistrationId: 'HRB 12345',
  email: 'rechnung@sonnenberg.example',
};

const smallBusinessSeller: InvoiceSeller = {
  name: 'Erika Musterfrau Sanitär e. K.',
  address: { lines: ['Lindenweg 3'], postalCode: '01235', city: 'Sonnenstadt', countryCode: 'DE' },
  vatId: null,
  taxNumber: '123/456/78901',
  legalRegistrationId: 'HRA 6789',
  email: null,
};

const standard = (rateBasisPoints: number): InvoiceTax => ({ category: 'S', rateBasisPoints });
const STANDARD = standard(1900);
const REDUCED = standard(700);

const line = (
  id: string,
  name: string,
  quantity: string,
  unitCode: string,
  unitPriceCents: number,
  tax: InvoiceLine['tax'] = STANDARD,
  priceQuantity: InvoiceLine['priceQuantity'] = 1,
): InvoiceLine => ({ id, name, description: '', quantity, unitCode, unitPriceCents, priceQuantity, tax });

const base: InvoiceDraft = {
  typeCode: '380',
  number: 'RE-2026-0001',
  issueDate: '2026-11-14',
  currency: 'EUR',
  seller,
  buyer: {
    name: 'Hausverwaltung Lindenhof GmbH',
    address: { lines: ['Lindenhof 5', '2. OG'], postalCode: '09876', city: 'Lindenstadt', countryCode: 'DE' },
    vatId: null,
    email: null,
  },
  deliverTo: null,
  delivery: { kind: 'date', date: '2026-11-10' },
  buyerReference: null,
  orderReference: null,
  precedingInvoice: null,
  paymentTerms: { dueInDays: 14, discount: null },
  payee: { iban: 'DE00111111111111111111', bic: 'BYLADEM1001', accountName: null },
  notes: [],
  lines: [],
};

/** 19 %: a repair with a three-decimal quantity, a price per 100 and a negative line. */
export const STANDARD_RATE_INVOICE: InvoiceDraft = {
  ...base,
  deliverTo: {
    name: 'Erika Musterfrau',
    address: { lines: ['Ahornweg 7'], postalCode: '09876', city: 'Lindenstadt', countryCode: 'DE' },
  },
  delivery: { kind: 'period', start: '2026-11-03', end: '2026-11-07' },
  buyerReference: 'Objekt Ahornweg 7',
  orderReference: 'B-4711',
  paymentTerms: { dueInDays: 14, discount: { days: 7, percentBasisPoints: 200 } },
  notes: ['Vielen Dank für deinen Auftrag.'],
  lines: [
    { ...line('1', 'Heizkörperventil tauschen', '2', 'H87', 2450), description: 'Thermostatventil DN 15' },
    line('2', 'Monteurstunde', '3.25', 'HUR', 6800),
    line('3', 'Kupferrohr 15 mm', '12.125', 'MTR', 1234, STANDARD, 100),
    line('4', 'Gutschrift Anfahrt', '-1', 'LS', 3500),
  ],
};

/** 19 % and 7 % on one invoice. */
export const MIXED_RATE_INVOICE: InvoiceDraft = {
  ...base,
  number: 'RE-2026-0002',
  lines: [
    line('1', 'Wartung Gasheizung', '1', 'LS', 18900),
    line('2', 'Fachbuch Heizungstechnik', '1', 'H87', 3990, REDUCED),
    line('3', 'Dichtungen', '4', 'H87', 99),
  ],
};

/** A small business under § 19 UStG: no VAT, the exemption reason, no USt-IdNr. */
export const EXEMPT_INVOICE: InvoiceDraft = {
  ...base,
  number: '2026-17',
  seller: smallBusinessSeller,
  payee: { iban: 'DE00111111111111111111', bic: null, accountName: 'Erika Musterfrau' },
  lines: [
    line('1', 'Abflussreinigung', '1.5', 'HUR', 5500, {
      category: 'E',
      exemptionReason: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    }),
  ],
};

/** A Storno: the corrected invoice (384) with negated lines, naming the invoice it cancels. */
export const STORNO_INVOICE: InvoiceDraft = {
  ...MIXED_RATE_INVOICE,
  typeCode: '384',
  number: 'RE-2026-0003',
  issueDate: '2026-11-20',
  precedingInvoice: { number: MIXED_RATE_INVOICE.number, issueDate: MIXED_RATE_INVOICE.issueDate },
  paymentTerms: { dueInDays: 0, discount: null },
  lines: MIXED_RATE_INVOICE.lines.map((entry) => ({ ...entry, quantity: `-${entry.quantity}` })),
};

export const REFERENCE_INVOICES = {
  STANDARD_RATE_INVOICE,
  MIXED_RATE_INVOICE,
  EXEMPT_INVOICE,
  STORNO_INVOICE,
};
