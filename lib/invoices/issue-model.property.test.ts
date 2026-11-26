import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import {
  ISSUE_SNAPSHOT,
  draftLineValuesArbitrary,
  invoiceLineSourceArbitrary,
  invoiceTermsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { draftAmounts } from './amounts';
import { invoiceDraftOf } from './issue-model';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "Issuing": the issued invoice is the checked draft under
// its number, so its line amounts, VAT per rate and totals are the ones the draft showed, whatever
// catalog source a line came from, and an invoice without a Leistungsdatum is not issued.

/** Lines of up to 500 pieces, which keep a 40-line draft inside the core's exact range. */
const lineArbitrary = fc
  .tuple(
    draftLineValuesArbitrary(fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) })),
    invoiceLineSourceArbitrary,
  )
  .map(([line, source]) => ({ ...line, netCents: 0, source }));

const storedArbitrary = fc
  .tuple(invoiceTermsArbitrary, fc.array(lineArbitrary, { minLength: 1, maxLength: 40 }))
  .map(([terms, lines]) => ({ ...terms, lines, cancels: null, cancellationReason: null }));

const ISSUE = { number: 'RE-2037-001', issueDate: '2037-11-20' };

describe('An issued invoice', () => {
  test('keeps the draft’s line amounts, VAT per rate and totals, whatever source each line came from', () => {
    fc.assert(
      fc.property(
        storedArbitrary.filter((stored) => stored.serviceStart !== null),
        (stored) => {
          const draft = invoiceDraftOf(stored, ISSUE_SNAPSHOT, ISSUE);
          if (!draft) throw new Error('an invoice with a Leistungsdatum has no draft');
          const issued = calculateInvoice(draft);
          const shown = draftAmounts(stored.lines);
          expect(issued.lines.map((line) => line.netCents)).toEqual(shown.lineNetCents);
          expect(issued.taxSubtotals).toEqual(shown.taxSubtotals);
          expect({
            lineNetCents: issued.totals.lineNetCents,
            taxCents: issued.totals.taxCents,
            grossCents: issued.totals.grossCents,
          }).toEqual(shown.totals);
          expect(
            issued.lines.map((line) => [line.quantity, line.unitPriceCents, line.priceQuantity]),
          ).toEqual(stored.lines.map((line) => [line.quantity, line.unitPriceCents, line.priceQuantity]));
        },
      ),
    );
  });

  test('takes a Leistungsdatum: without a service day there is no invoice to issue', () => {
    fc.assert(
      fc.property(storedArbitrary, (stored) => {
        const draft = invoiceDraftOf(stored, ISSUE_SNAPSHOT, ISSUE);
        expect(draft === null).toBe(stored.serviceStart === null || stored.serviceEnd === null);
      }),
    );
  });
});
