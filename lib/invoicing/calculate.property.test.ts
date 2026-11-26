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
        const expected = draft.lines.map((line) =>
          lineAmountCents(line.quantity, line.unitPriceCents, line.priceQuantity),
        );
        const { lines, totals } = calculateInvoice(draft);
        expect(lines.map((line) => line.netCents)).toEqual(expected);
        expect(totals.lineNetCents).toBe(expected.reduce((sum, net) => sum + net, 0));
      }),
    );
  });

  test('has one VAT row per category and rate of the draft’s lines, each the sum of those lines', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const expected = new Map<string, number>();
        for (const line of draft.lines) {
          const net = lineAmountCents(line.quantity, line.unitPriceCents, line.priceQuantity);
          expected.set(rateKey(line.tax), (expected.get(rateKey(line.tax)) ?? 0) + net);
        }
        const { taxSubtotals, totals } = calculateInvoice(draft);
        const rows = new Map(taxSubtotals.map((row) => [rateKey(row.tax), row.basisCents]));
        expect(rows.size).toBe(taxSubtotals.length);
        expect(rows).toEqual(expected);
        expect(taxSubtotals.reduce((sum, row) => sum + row.basisCents, 0)).toBe(totals.lineNetCents);
      }),
    );
  });

  test('rounds VAT once per rate on the rate’s sum, half away from zero, and owes none on a zero rate or exemption', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const expected = new Map<string, bigint>();
        for (const line of draft.lines) {
          const rate = line.tax.category === 'S' ? line.tax.rateBasisPoints : 0;
          const net = lineAmountCents(line.quantity, line.unitPriceCents, line.priceQuantity);
          const key = rateKey(line.tax);
          expected.set(key, (expected.get(key) ?? BigInt(0)) + BigInt(net) * BigInt(rate));
        }
        const { taxSubtotals, totals } = calculateInvoice(draft);
        const tax = new Map(taxSubtotals.map((row) => [rateKey(row.tax), row.taxCents]));
        expect(tax).toEqual(
          new Map(
            [...expected].map(([key, product]) => [
              key,
              Number(roundHalfAwayFromZero(product, BigInt(10_000))),
            ]),
          ),
        );
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
