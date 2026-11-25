import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { lineAmountCents } from '@/lib/inventory/line-amount';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { STANDARD_RATE_INVOICE } from '@/lib/invoicing/fixtures/reference-invoices';
import {
  draftLineValuesArbitrary,
  priceCentsArbitrary,
  priceQuantityArbitrary,
  quantityText,
  quantityThousandthsArbitrary,
  roundHalfAwayFromZero,
} from '@/lib/testing/invoice-arbitraries';
import { draftAmounts } from './amounts';
import type { InvoiceLineValues } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "Invoice drafts": each line amount and the totals (net,
// VAT per rate on the sum of that rate's lines, gross) come from the one invoice core.

const MAX_LINE_NET_CENTS = BigInt(1_000_000_000_000);

/** Lines of up to 500 pieces, which keep a 40-line draft inside the core's exact range. */
const draftLineArbitrary = draftLineValuesArbitrary(
  fc.bigInt({ min: BigInt(-50_000), max: BigInt(500_000) }),
);

const line = (
  thousandths: bigint,
  unitPriceCents: number,
  priceQuantity: InvoiceLineValues['priceQuantity'],
) => ({
  name: 'Position',
  description: '',
  quantity: quantityText(thousandths),
  unit: 'piece',
  unitPriceCents,
  priceQuantity,
  taxRateBasisPoints: 1900 as const,
});

describe('A draft’s amounts', () => {
  test('are the invoice core’s amounts for the same lines', () => {
    fc.assert(
      fc.property(fc.array(draftLineArbitrary, { minLength: 1, maxLength: 40 }), (lines) => {
        const amounts = draftAmounts(lines);
        const core = calculateInvoice({
          ...STANDARD_RATE_INVOICE,
          lines: lines.map((draftLine, index) => ({
            id: String(index + 1),
            name: draftLine.name,
            description: draftLine.description,
            quantity: draftLine.quantity,
            unitCode: draftLine.unit,
            unitPriceCents: draftLine.unitPriceCents,
            priceQuantity: draftLine.priceQuantity,
            tax:
              draftLine.taxRateBasisPoints === 0
                ? { category: 'Z' }
                : { category: 'S', rateBasisPoints: draftLine.taxRateBasisPoints },
          })),
        });
        expect(amounts.lineNetCents).toEqual(core.lines.map((coreLine) => coreLine.netCents));
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

  test('take a line up to ten billion euros and refuse one a cent beyond', () => {
    fc.assert(
      fc.property(
        quantityThousandthsArbitrary,
        priceCentsArbitrary,
        priceQuantityArbitrary,
        (thousandths, unitPriceCents, priceQuantity) => {
          const exact = roundHalfAwayFromZero(
            thousandths * BigInt(unitPriceCents),
            BigInt(priceQuantity) * BigInt(1000),
          );
          const draftLine = line(thousandths, unitPriceCents, priceQuantity);
          if (exact > MAX_LINE_NET_CENTS || exact < -MAX_LINE_NET_CENTS)
            expect(() => draftAmounts([draftLine])).toThrow(RangeError);
          else
            expect(draftAmounts([draftLine]).lineNetCents).toEqual([
              lineAmountCents(draftLine.quantity, unitPriceCents, priceQuantity),
            ]);
        },
      ),
      {
        examples: [
          [BigInt(10_000_000), 100_000_000, 1],
          [BigInt(999_000_999_002), 1001, 1],
          [BigInt(-10_000_000), 100_000_000, 1],
          [BigInt(-999_000_999_002), 1001, 1],
        ],
      },
    );
  });

  // known bug: werk-flow/werkflow-planning#520 the VAT product of one rate passes the safe-integer range
  test.failing('total three lines of ten billion euros at 19 %, which the save accepts', () => {
    const atTheCap = line(BigInt(10_000_000), 100_000_000, 1);
    expect(draftAmounts([atTheCap, atTheCap, atTheCap]).totals.grossCents).toBe(3_570_000_000_000);
  });
});
