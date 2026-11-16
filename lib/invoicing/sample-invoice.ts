import type { InvoiceDraft, InvoiceTax } from './model';

const STANDARD: InvoiceTax = { category: 'S', rateBasisPoints: 1900 };

/**
 * The fixed Musterrechnung the settings offer as an e-invoice: a heating
 * repair for a made-up customer at 19 %, from the caller's seller and payee,
 * dated the day it is made.
 */
export function sampleInvoice(
  seller: InvoiceDraft['seller'],
  payee: InvoiceDraft['payee'],
  issueDate: string,
): InvoiceDraft {
  return {
    typeCode: '380',
    number: 'MUSTER-1',
    issueDate,
    currency: 'EUR',
    seller,
    buyer: {
      name: 'Hausverwaltung Ahornhof GmbH',
      address: { lines: ['Ahornweg 7'], postalCode: '09876', city: 'Ahornstadt', countryCode: 'DE' },
      vatId: null,
      email: null,
    },
    deliverTo: null,
    delivery: { kind: 'date', date: issueDate },
    buyerReference: null,
    orderReference: null,
    precedingInvoice: null,
    paymentTerms: { dueInDays: 14, discount: null },
    payee,
    notes: ['Musterrechnung mit erfundenem Kunden und erfundenen Preisen.'],
    lines: [
      {
        id: '1',
        name: 'Umwälzpumpe tauschen',
        description: 'Hocheffizienzpumpe 25-60 liefern und einbauen.',
        quantity: '1',
        unitCode: 'H87',
        unitPriceCents: 32900,
        priceQuantity: 1,
        tax: STANDARD,
      },
      {
        id: '2',
        name: 'Monteurstunde',
        description: '',
        quantity: '1.5',
        unitCode: 'HUR',
        unitPriceCents: 7200,
        priceQuantity: 1,
        tax: STANDARD,
      },
      {
        id: '3',
        name: 'Anfahrtspauschale',
        description: '',
        quantity: '1',
        unitCode: 'LS',
        unitPriceCents: 4500,
        priceQuantity: 1,
        tax: STANDARD,
      },
    ],
  };
}
