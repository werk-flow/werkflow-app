import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { invoiceDraftArbitrary } from '@/lib/testing/invoice-arbitraries';
import { calculateInvoice } from './calculate';
import { toEn16931 } from './to-en16931';

// Property tests (docs/technical/testing.md, "Property tests"). The e-invoice carries the invoice
// core's amounts (docs/features/commercial-and-finance.md, "Muster-E-Rechnung"): every amount the
// XML states reads back as the cents the core computed, and the sums hold in the XML itself
// (EN 16931 BR-CO-10 to BR-CO-16).

/** The cents of every `<ram:{name}>` amount in document order; a currency attribute is allowed. */
function amountsOf(xml: string, name: string): number[] {
  return [
    ...xml.matchAll(new RegExp(`<ram:${name}(?: [^>]*)?>(-?)(\\d+)\\.(\\d{2})</ram:${name}>`, 'g')),
  ].map(
    ([, sign, whole = '0', fraction = '0']) => (sign ? -1 : 1) * (Number(whole) * 100 + Number(fraction)),
  );
}

const paidShareArbitrary = fc.double({ min: 0, max: 1, noNaN: true });

describe('An e-invoice', () => {
  test('states every line amount, VAT row and total as the cents the invoice core computed', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, paidShareArbitrary, (draft, share) => {
        const gross = calculateInvoice(draft).totals.grossCents;
        const invoice = calculateInvoice({ ...draft, paidCents: Math.floor(Math.max(gross, 0) * share) });
        const xml = toEn16931(invoice);
        const { totals } = invoice;
        expect(amountsOf(xml, 'LineTotalAmount')).toEqual([
          ...invoice.lines.map((line) => line.netCents),
          totals.lineNetCents,
        ]);
        expect(amountsOf(xml, 'BasisAmount')).toEqual(invoice.taxSubtotals.map((row) => row.basisCents));
        expect(amountsOf(xml, 'CalculatedAmount')).toEqual(invoice.taxSubtotals.map((row) => row.taxCents));
        expect(amountsOf(xml, 'TaxBasisTotalAmount')).toEqual([totals.lineNetCents]);
        expect(amountsOf(xml, 'TaxTotalAmount')).toEqual([totals.taxCents]);
        expect(amountsOf(xml, 'GrandTotalAmount')).toEqual([totals.grossCents]);
        expect(amountsOf(xml, 'TotalPrepaidAmount')).toEqual(totals.paidCents ? [totals.paidCents] : []);
        expect(amountsOf(xml, 'DuePayableAmount')).toEqual([totals.dueCents]);
      }),
    );
  });

  test('adds up in itself: lines to the net, VAT rows to the tax, net and tax to the gross, gross minus prepaid to the due', () => {
    fc.assert(
      fc.property(invoiceDraftArbitrary, (draft) => {
        const xml = toEn16931(calculateInvoice(draft));
        const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
        const lineTotals = amountsOf(xml, 'LineTotalAmount');
        const [net] = lineTotals.splice(-1, 1);
        expect(sum(lineTotals)).toBe(net ?? Number.NaN);
        expect(sum(amountsOf(xml, 'BasisAmount'))).toBe(net ?? Number.NaN);
        const [tax] = amountsOf(xml, 'TaxTotalAmount');
        expect(sum(amountsOf(xml, 'CalculatedAmount'))).toBe(tax ?? Number.NaN);
        const [gross] = amountsOf(xml, 'GrandTotalAmount');
        expect(gross).toBe((net ?? Number.NaN) + (tax ?? Number.NaN));
        expect(amountsOf(xml, 'DuePayableAmount')).toEqual([
          (gross ?? Number.NaN) - sum(amountsOf(xml, 'TotalPrepaidAmount')),
        ]);
      }),
    );
  });
});
