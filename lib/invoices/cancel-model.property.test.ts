import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import {
  ISSUE_SNAPSHOT,
  draftLineValuesArbitrary,
  invoiceLineSourceArbitrary,
  invoiceTermsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { negatedQuantity, stornoOf } from './cancel-model';
import { invoiceDraftOf } from './issue-model';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "Storno and correction": the Stornorechnung carries every
// line of the cancelled invoice with its quantity negated, so the invoice core computes each line
// amount, the VAT per rate and the totals of the original negated, never -0, and the Stornorechnung
// stores exactly those amounts.

const ISSUE = { number: 'RE-2037-001', issueDate: '2037-11-20' };
const STORNO_ISSUE = { number: 'RE-2037-002', issueDate: '2037-11-21' };

/** Lines of up to 500 pieces, which keep a 40-line invoice inside the core's exact range. */
const lineArbitrary = fc
  .tuple(
    draftLineValuesArbitrary(fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) })),
    invoiceLineSourceArbitrary,
  )
  .map(([line, source]) => ({ ...line, netCents: 0, source }));

/** An issued invoice: drawn terms and lines with the amounts the invoice core computed at its issue. */
const issuedArbitrary = fc
  .tuple(
    invoiceTermsArbitrary.filter((terms) => terms.serviceStart !== null),
    fc.array(lineArbitrary, { minLength: 1, maxLength: 40 }),
  )
  .map(([terms, drawn]) => {
    const stored = { ...terms, lines: drawn, cancels: null, cancellationReason: null };
    const draft = invoiceDraftOf(stored, ISSUE_SNAPSHOT, ISSUE);
    if (!draft) throw new Error('an invoice with a Leistungsdatum has no draft');
    const calculated = calculateInvoice(draft);
    return {
      invoice: {
        ...stored,
        id: '98300000-0000-4000-8000-000000000001',
        invoiceNumber: ISSUE.number,
        issueDate: ISSUE.issueDate,
        lines: drawn.map((line, index) => ({ ...line, netCents: calculated.lines[index]?.netCents ?? 0 })),
        lineNetCents: calculated.totals.lineNetCents,
        taxCents: calculated.totals.taxCents,
        grossCents: calculated.totals.grossCents,
      },
      calculated,
    };
  });

/** The negated amount, as a Stornorechnung owes it: zero stays 0, never -0. */
const negated = (cents: number): number => (cents === 0 ? 0 : -cents);

describe('A Stornorechnung', () => {
  test('negates every line amount, the VAT per rate and the totals of its original, never -0', () => {
    fc.assert(
      fc.property(issuedArbitrary, ({ invoice, calculated: original }) => {
        const storno = stornoOf(invoice, 'Falscher Rechnungsempfänger');
        const draft = invoiceDraftOf(storno, ISSUE_SNAPSHOT, STORNO_ISSUE);
        if (!draft) throw new Error('a Stornorechnung of an issued invoice has no draft');
        const calculated = calculateInvoice(draft);

        expect(calculated.lines.map((line) => line.netCents)).toEqual(
          original.lines.map((line) => negated(line.netCents)),
        );
        expect(calculated.taxSubtotals).toEqual(
          original.taxSubtotals.map((subtotal) => ({
            ...subtotal,
            basisCents: negated(subtotal.basisCents),
            taxCents: negated(subtotal.taxCents),
          })),
        );
        const totals = {
          lineNetCents: calculated.totals.lineNetCents,
          taxCents: calculated.totals.taxCents,
          grossCents: calculated.totals.grossCents,
        };
        expect(totals).toEqual({
          lineNetCents: negated(original.totals.lineNetCents),
          taxCents: negated(original.totals.taxCents),
          grossCents: negated(original.totals.grossCents),
        });
        // What the Stornorechnung stores is what the core computes from it.
        expect(storno.lines.map((line) => line.netCents)).toEqual(
          calculated.lines.map((line) => line.netCents),
        );
        expect({
          lineNetCents: storno.lineNetCents,
          taxCents: storno.taxCents,
          grossCents: storno.grossCents,
        }).toEqual(totals);
      }),
    );
  });

  test('keeps each line of its original in order, with its source, price and rate, and its quantity negated', () => {
    fc.assert(
      fc.property(issuedArbitrary, ({ invoice }) => {
        const storno = stornoOf(invoice, 'Falscher Rechnungsempfänger');
        // Negated back, each Storno line is its original's line again, amount aside.
        const restored = storno.lines.map((line, index) => ({
          ...line,
          quantity: negatedQuantity(line.quantity),
          netCents: invoice.lines[index]?.netCents,
        }));
        expect(restored).toEqual(invoice.lines);
      }),
    );
  });
});
