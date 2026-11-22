import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import { lineAmountCents } from '@/lib/inventory/line-amount';
import { invoiceDraftArbitrary, roundHalfAwayFromZero } from '@/lib/testing/invoice-arbitraries';
import { balanceOf, calculateInvoice, taxRateBasisPoints } from './calculate';
import type { InvoiceDraft } from './model';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/commercial-and-finance.md and EN 16931: each line amount by the shared line rule,
// VAT per rate on the sum of that rate's line amounts, rounded once (BR-CO-17), and the totals
// as sums of those (BR-CO-10 to BR-CO-16). Skonto is a term and changes no amount.

const rateKey = (tax: InvoiceDraft['lines'][number]['tax']): string =>
  `${tax.category}:${taxRateBasisPoints(tax)}`;

/** The same draft with every quantity negated: its Storno. */
function negated(draft: InvoiceDraft): InvoiceDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      quantity: line.quantity.startsWith('-') ? line.quantity.slice(1) : `-${line.quantity}`,
    })),
  };
}

const paidShareArbitrary = fc.double({ min: 0, max: 1, noNaN: true });

describe('An invoice', () => {
  test('totals the sum of its line amounts, each by the shared line rule', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const { lines, totals } = calculateInvoice(draft);
        lines.forEach((line) =>
          expect(line.netCents).toBe(lineAmountCents(line.quantity, line.unitPriceCents, line.priceQuantity)),
        );
        expect(totals.lineNetCents).toBe(lines.reduce((sum, line) => sum + line.netCents, 0));
      }),
    );
  });

  test('has one VAT row per category and rate, whose bases add up to the net total', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const { lines, taxSubtotals, totals } = calculateInvoice(draft);
        const keys = taxSubtotals.map((row) => rateKey(row.tax));
        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(keys)).toEqual(new Set(lines.map((line) => rateKey(line.tax))));
        for (const row of taxSubtotals) {
          const basis = lines
            .filter((line) => rateKey(line.tax) === rateKey(row.tax))
            .reduce((sum, line) => sum + line.netCents, 0);
          expect(row.basisCents).toBe(basis);
        }
        expect(taxSubtotals.reduce((sum, row) => sum + row.basisCents, 0)).toBe(totals.lineNetCents);
      }),
    );
  });

  test('rounds VAT once per rate on the rate’s sum, half away from zero, and owes none on a zero rate or exemption', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const { taxSubtotals, totals } = calculateInvoice(draft);
        for (const row of taxSubtotals) {
          const rate = row.tax.category === 'S' ? row.tax.rateBasisPoints : 0;
          const expected = roundHalfAwayFromZero(BigInt(row.basisCents) * BigInt(rate), BigInt(10_000));
          expect(row.taxCents).toBe(Number(expected));
          if (row.tax.category !== 'S') expect(row.taxCents).toBe(0);
        }
        expect(totals.taxCents).toBe(taxSubtotals.reduce((sum, row) => sum + row.taxCents, 0));
      }),
    );
  });

  test('owes the gross, net plus VAT, minus what was paid, and asks for it only while some is due', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, paidShareArbitrary, (draft, share) => {
        const gross = calculateInvoice(draft).totals.grossCents;
        const paidCents = Math.floor(Math.max(gross, 0) * share);
        const calculated = calculateInvoice({ ...draft, paidCents });
        const { totals } = calculated;
        expect(totals.grossCents).toBe(totals.lineNetCents + totals.taxCents);
        expect(totals.paidCents).toBe(paidCents);
        expect(totals.dueCents).toBe(totals.grossCents - paidCents);
        const balance = balanceOf(totals);
        expect(balance === 'due').toBe(totals.dueCents > 0);
        expect(balance === 'credit').toBe(totals.dueCents < 0);
        if (balance === 'paid') expect(paidCents).toBeGreaterThan(0);
      }),
    );
  });

  test('refuses a paid amount above the gross, below zero or in fractions of a cent', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, fc.integer({ min: 1, max: 1_000_000 }), (draft, excess) => {
        const gross = Math.max(calculateInvoice(draft).totals.grossCents, 0);
        expect(() => calculateInvoice({ ...draft, paidCents: gross + excess })).toThrow(RangeError);
        expect(() => calculateInvoice({ ...draft, paidCents: -excess })).toThrow(RangeError);
        expect(() => calculateInvoice({ ...draft, paidCents: excess - 0.5 })).toThrow(RangeError);
      }),
    );
  });

  test('keeps every amount when its lines change order', () => {
    fc.assert(
      fc.property(
        invoiceDraftArbitrary.chain((draft) =>
          fc.tuple(fc.constant(draft), fc.shuffledSubarray(draft.lines, { minLength: draft.lines.length })),
        ),
        ([draft, shuffled]) => {
          const original = calculateInvoice(draft);
          const reordered = calculateInvoice({ ...draft, lines: shuffled });
          expect(reordered.totals).toEqual(original.totals);
          const byKey = (rows: typeof original.taxSubtotals) =>
            Object.fromEntries(rows.map((row) => [rateKey(row.tax), [row.basisCents, row.taxCents]]));
          expect(byKey(reordered.taxSubtotals)).toEqual(byKey(original.taxSubtotals));
        },
      ),
    );
  });

  test('as a Storno of the same lines negates every amount', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const original = calculateInvoice(draft).totals;
        const storno = calculateInvoice(negated(draft)).totals;
        expect(storno.lineNetCents + original.lineNetCents).toBe(0);
        expect(storno.taxCents + original.taxCents).toBe(0);
        expect(storno.grossCents + original.grossCents).toBe(0);
      }),
    );
  });

  test('is due the Zahlungsziel after its date, and a Skonto changes no amount', () => {
    fc.assert(
      fc.property(
        invoiceDraftArbitrary,
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 9999 }),
        (draft, days, percentBasisPoints) => {
          const plain = calculateInvoice(draft);
          expect(plain.dueDate).toBe(addLocalDays(draft.issueDate, draft.paymentTerms.dueInDays));
          const withSkonto = calculateInvoice({
            ...draft,
            paymentTerms: { ...draft.paymentTerms, discount: { days, percentBasisPoints } },
          });
          expect(withSkonto.totals).toEqual(plain.totals);
          expect(withSkonto.taxSubtotals).toEqual(plain.taxSubtotals);
        },
      ),
    );
  });
});
