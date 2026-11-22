import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { lineAmountCents } from '@/lib/inventory/line-amount';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { STANDARD_RATE_INVOICE } from '@/lib/invoicing/fixtures/reference-invoices';
import {
  priceCentsArbitrary,
  priceQuantityArbitrary,
  quantityText,
  quantityThousandthsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { draftAmounts } from './amounts';
import { INVOICE_TAX_RATES, type InvoiceLineValues } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "Invoice drafts": each line amount and the totals (net,
// VAT per rate on the sum of that rate's lines, gross) come from the one invoice core.

const MAX_LINE_NET_CENTS = 1_000_000_000_000;

const draftLineArbitrary: fc.Arbitrary<InvoiceLineValues> = fc
  .record({
    thousandths: fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) }),
    unitPriceCents: priceCentsArbitrary,
    priceQuantity: priceQuantityArbitrary,
    taxRateBasisPoints: fc.constantFrom(...INVOICE_TAX_RATES),
  })
  .map(({ thousandths, ...line }) => ({
    ...line,
    name: 'Position',
    description: '',
    quantity: quantityText(thousandths),
    unit: 'piece',
  }));

describe('A draft’s amounts', () => {
  test('are the invoice core’s amounts for the same lines', () => {
    fc.assert(
      fc.property(fc.array(draftLineArbitrary, { minLength: 1, maxLength: 40 }), (lines) => {
        const amounts = draftAmounts(lines);
        const core = calculateInvoice({
          ...STANDARD_RATE_INVOICE,
          lines: lines.map((line, index) => ({
            id: String(index + 1),
            name: line.name,
            description: line.description,
            quantity: line.quantity,
            unitCode: line.unit,
            unitPriceCents: line.unitPriceCents,
            priceQuantity: line.priceQuantity,
            tax:
              line.taxRateBasisPoints === 0
                ? { category: 'Z' }
                : { category: 'S', rateBasisPoints: line.taxRateBasisPoints },
          })),
        });
        expect(amounts.lineNetCents).toEqual(core.lines.map((line) => line.netCents));
        expect(amounts.taxSubtotals).toEqual(core.taxSubtotals);
        expect(amounts.totals).toEqual({
          lineNetCents: core.totals.lineNetCents,
          taxCents: core.totals.taxCents,
          grossCents: core.totals.grossCents,
        });
      }),
    );
  });

  test('total zero without lines', () => {
    expect(draftAmounts([]).totals).toEqual({ lineNetCents: 0, taxCents: 0, grossCents: 0 });
  });

  test('refuse a line above ten billion euros and take every line up to it', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, unitPriceCents, priceQuantity) => {
          const line: InvoiceLineValues = {
            name: 'Position',
            description: '',
            quantity: quantityText(thousandths),
            unit: 'piece',
            unitPriceCents,
            priceQuantity,
            taxRateBasisPoints: 1900,
          };
          const exact = (Number(thousandths) * unitPriceCents) / priceQuantity / 1000;
          fc.pre(Math.abs(Math.abs(exact) - MAX_LINE_NET_CENTS) > 1);
          if (Math.abs(exact) > MAX_LINE_NET_CENTS) expect(() => draftAmounts([line])).toThrow(RangeError);
          else
            expect(draftAmounts([line]).lineNetCents).toEqual([
              lineAmountCents(line.quantity, unitPriceCents, priceQuantity),
            ]);
        },
      ),
    );
  });
});
