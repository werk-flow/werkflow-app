import { describe, expect, test } from 'bun:test';

import { calculateInvoice } from './calculate';
import {
  EXEMPT_INVOICE,
  MIXED_RATE_INVOICE,
  REFERENCE_INVOICES,
  STANDARD_RATE_INVOICE,
  STORNO_INVOICE,
} from './fixtures/reference-invoices';
import type { CalculatedInvoice, InvoiceDraft } from './model';

// The arithmetic of the invoice core: each line rounded once (lib/inventory's
// line rule), VAT per category and rate on the sum of that rate's lines
// (EN 16931 BR-CO), never per line.
const CASES: ReadonlyArray<{
  case: string;
  draft: InvoiceDraft;
  lineNetCents: number[];
  taxSubtotals: Array<{ rate: number | null; basisCents: number; taxCents: number }>;
  totals: CalculatedInvoice['totals'];
}> = [
  {
    case: 'a three-decimal quantity, a price per 100 and a negative line at 19 %',
    draft: STANDARD_RATE_INVOICE,
    // 2 × 24,50; 3,25 h × 68,00; 12,125 m × 12,34 € per 100 m = 1,4962 → 1,50; −35,00
    lineNetCents: [4900, 22100, 150, -3500],
    taxSubtotals: [{ rate: 1900, basisCents: 23650, taxCents: 4494 }],
    totals: { lineNetCents: 23650, taxCents: 4494, grossCents: 28144 },
  },
  {
    case: 'two tax rates, each taxed on its own sum',
    draft: MIXED_RATE_INVOICE,
    lineNetCents: [18900, 3990, 396],
    taxSubtotals: [
      // 19 % of 192,96 = 36,6624 → 36,66
      { rate: 1900, basisCents: 19296, taxCents: 3666 },
      // 7 % of 39,90 = 2,793 → 2,79
      { rate: 700, basisCents: 3990, taxCents: 279 },
    ],
    totals: { lineNetCents: 23286, taxCents: 3945, grossCents: 27231 },
  },
  {
    case: 'a § 19 UStG exemption carries no VAT',
    draft: EXEMPT_INVOICE,
    lineNetCents: [8250],
    taxSubtotals: [{ rate: null, basisCents: 8250, taxCents: 0 }],
    totals: { lineNetCents: 8250, taxCents: 0, grossCents: 8250 },
  },
  {
    case: 'a Storno negates every amount, rounding half away from zero',
    draft: STORNO_INVOICE,
    lineNetCents: [-18900, -3990, -396],
    taxSubtotals: [
      { rate: 1900, basisCents: -19296, taxCents: -3666 },
      { rate: 700, basisCents: -3990, taxCents: -279 },
    ],
    totals: { lineNetCents: -23286, taxCents: -3945, grossCents: -27231 },
  },
];

const rateOf = (tax: CalculatedInvoice['taxSubtotals'][number]['tax']) =>
  tax.category === 'S' ? tax.rateBasisPoints : null;

describe('calculateInvoice', () => {
  for (const entry of CASES) {
    test(entry.case, () => {
      const invoice = calculateInvoice(entry.draft);
      expect(invoice.lines.map((line) => line.netCents)).toEqual(entry.lineNetCents);
      expect(
        invoice.taxSubtotals.map((row) => ({
          rate: rateOf(row.tax),
          basisCents: row.basisCents,
          taxCents: row.taxCents,
        })),
      ).toEqual(entry.taxSubtotals);
      expect(invoice.totals).toEqual(entry.totals);
    });
  }

  test('VAT is computed on the sum of a rate, never per line: three lines of 0,03 € at 19 % owe 0,02 €', () => {
    const [, , seal] = MIXED_RATE_INVOICE.lines;
    if (!seal) throw new Error('fixture without a third line');
    const invoice = calculateInvoice({
      ...MIXED_RATE_INVOICE,
      lines: ['1', '2', '3'].map((id) => ({ ...seal, id, quantity: '1', unitPriceCents: 3 })),
    });
    // Per line 0,57 ct would round to 1 ct each, 3 ct in all; on the sum 9 ct × 19 % = 1,71 → 2 ct.
    expect(invoice.taxSubtotals[0]?.taxCents).toBe(2);
  });

  test('the due date is the Zahlungsziel after the invoice date', () => {
    expect(calculateInvoice(STANDARD_RATE_INVOICE).dueDate).toBe('2026-11-28');
  });

  test('every reference invoice satisfies BR-CO-10 to BR-CO-16 in cents', () => {
    for (const draft of Object.values(REFERENCE_INVOICES)) {
      const invoice = calculateInvoice(draft);
      const lineSum = invoice.lines.reduce((sum, line) => sum + line.netCents, 0);
      const taxSum = invoice.taxSubtotals.reduce((sum, row) => sum + row.taxCents, 0);
      const basisSum = invoice.taxSubtotals.reduce((sum, row) => sum + row.basisCents, 0);
      expect(invoice.totals.lineNetCents).toBe(lineSum); // BR-CO-10, BR-CO-13
      expect(invoice.totals.taxCents).toBe(taxSum); // BR-CO-14
      expect(basisSum).toBe(lineSum); // BR-CO-18 with BR-CO-13
      expect(invoice.totals.grossCents).toBe(lineSum + taxSum); // BR-CO-15, BR-CO-16
    }
  });

  test('an exemption with two different reasons is refused, because one breakdown row holds one reason', () => {
    const [first] = EXEMPT_INVOICE.lines;
    if (!first) throw new Error('fixture without lines');
    expect(() =>
      calculateInvoice({
        ...EXEMPT_INVOICE,
        lines: [first, { ...first, id: '2', tax: { category: 'E', exemptionReason: 'Anderer Grund' } }],
      }),
    ).toThrow(RangeError);
  });

  test('an invoice without lines is refused', () => {
    expect(() => calculateInvoice({ ...MIXED_RATE_INVOICE, lines: [] })).toThrow(RangeError);
  });
});
