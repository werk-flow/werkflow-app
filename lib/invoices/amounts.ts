import { calculateInvoice } from '@/lib/invoicing/calculate';
import type { CalculatedInvoice, InvoiceParty } from '@/lib/invoicing/model';
import type { InvoiceLineValues, InvoiceTotals } from './types';

// The amounts of a draft come from the one invoice core (lib/invoicing/):
// each line by the shared line rule, VAT per rate on the sum of that rate's
// lines. The editor shows them while the office types; the server computes
// them again from the parsed input and stores what it computed.

// The amounts depend on the lines only; issuing maps the real seller, buyer,
// date and terms (werk-flow/werkflow-planning#457).
const NO_PARTY: InvoiceParty = {
  name: '',
  address: { lines: [''], postalCode: '', city: '', countryCode: 'DE' },
  vatId: null,
  email: null,
};

export type DraftAmounts = Pick<CalculatedInvoice, 'taxSubtotals'> & {
  lineNetCents: number[];
  totals: InvoiceTotals;
};

const NO_DATE = '2000-01-01';

/**
 * The largest line amount a draft takes: ten billion euros. With at most 500
 * lines every sum the core forms stays an exact integer, so no cent is lost
 * between lines that cancel out.
 */
const MAX_LINE_NET_CENTS = 1_000_000_000_000;

/**
 * Every amount of a draft's lines. A draft without lines totals zero. Throws
 * a RangeError on a line the line rule refuses or above the largest line amount.
 */
export function draftAmounts(lines: readonly InvoiceLineValues[]): DraftAmounts {
  if (lines.length === 0) {
    return { lineNetCents: [], taxSubtotals: [], totals: { lineNetCents: 0, taxCents: 0, grossCents: 0 } };
  }
  const calculated = calculateInvoice({
    typeCode: '380',
    number: '',
    issueDate: NO_DATE,
    currency: 'EUR',
    seller: { ...NO_PARTY, taxNumber: null, legalRegistrationId: null },
    buyer: NO_PARTY,
    deliverTo: null,
    delivery: { kind: 'date', date: NO_DATE },
    buyerReference: null,
    orderReference: null,
    precedingInvoice: null,
    paymentTerms: { dueInDays: 0, discount: null },
    payee: null,
    notes: [],
    lines: lines.map((line, index) => ({
      id: String(index + 1),
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      // Not written anywhere: issuing maps the unit to its UN/ECE code.
      unitCode: line.unit,
      unitPriceCents: line.unitPriceCents,
      priceQuantity: line.priceQuantity,
      tax:
        line.taxRateBasisPoints === 0
          ? { category: 'Z' }
          : { category: 'S', rateBasisPoints: line.taxRateBasisPoints },
    })),
  });
  if (calculated.lines.some((line) => Math.abs(line.netCents) > MAX_LINE_NET_CENTS)) {
    throw new RangeError('A line amount exceeds ten billion euros.');
  }
  return {
    lineNetCents: calculated.lines.map((line) => line.netCents),
    taxSubtotals: calculated.taxSubtotals,
    totals: {
      lineNetCents: calculated.totals.lineNetCents,
      taxCents: calculated.totals.taxCents,
      grossCents: calculated.totals.grossCents,
    },
  };
}
