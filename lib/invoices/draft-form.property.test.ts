import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  draftLineValuesArbitrary,
  invoiceTermsArbitrary,
  quantityThousandthsArbitrary,
} from '@/lib/testing/invoice-arbitraries';
import { TERM_FIELD_IDS, draftFormOf, parseDraftForm } from './draft-form';
import type { InvoiceDetail } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/commercial-and-finance.md, "Invoice drafts": lines with a quantity of up to three
// decimals, negative for a credit, a net price, VAT 19, 7 or 0 %, a Zahlungsziel in days and an
// optional Skonto in percent and days. The editor shows a stored draft and saves it unchanged.

const lineArbitrary = fc
  .tuple(draftLineValuesArbitrary(quantityThousandthsArbitrary), fc.boolean())
  .map(([line, padded]) => ({
    ...line,
    quantity: padded ? paddedQuantity(line.quantity) : line.quantity,
    netCents: 0,
  }));

/** A quantity as `numeric(12,3)` returns it: „1.500“. */
function paddedQuantity(text: string): string {
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(3, '0')}`;
}

/** The quantity's value, whatever trailing zeros its text carries. */
const canonical = (quantity: string): string =>
  quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;

const detailArbitrary: fc.Arbitrary<InvoiceDetail> = fc
  .tuple(invoiceTermsArbitrary, fc.array(lineArbitrary, { minLength: 1, maxLength: 20 }))
  .map(([terms, lines]) => ({
    ...terms,
    id: '00000000-0000-4000-8000-000000000001',
    invoiceNumber: null,
    status: 'entwurf',
    version: 1,
    client: { id: '00000000-0000-4000-8000-000000000002', name: 'Kunde' },
    recipient: { id: '00000000-0000-4000-8000-000000000002', name: 'Kunde', address: null },
    work: null,
    lines,
    lineNetCents: 0,
    taxCents: 0,
    grossCents: 0,
  }));

describe('The draft editor', () => {
  test('saves a stored draft it shows unchanged: quantities, prices, rates, service days and Skonto', () => {
    fc.assert(
      fc.property(detailArbitrary, (detail) => {
        const parsed = parseDraftForm(draftFormOf(detail));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.lines).toEqual(
          detail.lines.map((line) => ({
            name: line.name,
            description: line.description,
            quantity: canonical(line.quantity),
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            priceQuantity: line.priceQuantity,
            taxRateBasisPoints: line.taxRateBasisPoints,
          })),
        );
        expect(parsed.terms).toEqual({
          serviceStart: detail.serviceStart,
          serviceEnd: detail.serviceEnd,
          paymentDueDays: detail.paymentDueDays,
          discountDays: detail.discountDays,
          discountBasisPoints: detail.discountBasisPoints,
          orderReference: detail.orderReference,
          buyerReference: detail.buyerReference,
          openingText: detail.openingText,
          closingText: detail.closingText,
        });
      }),
    );
  });

  test('reads a quantity typed with a comma as the same as with a dot', () => {
    fc.assert(
      fc.property(detailArbitrary, (detail) => {
        const form = draftFormOf(detail);
        const dotted = {
          ...form,
          lines: form.lines.map((line) => ({ ...line, quantity: line.quantity.replace(',', '.') })),
        };
        expect(parseDraftForm(dotted)).toEqual(parseDraftForm(form));
      }),
    );
  });

  test('refuses a Skonto period longer than the Zahlungsziel', () => {
    fc.assert(
      fc.property(detailArbitrary, fc.integer({ min: 1, max: 100 }), (detail, extra) => {
        const form = draftFormOf(detail);
        const days = detail.paymentDueDays + extra;
        fc.pre(days <= 365);
        const parsed = parseDraftForm({ ...form, discountPercent: '2', discountDays: String(days) });
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(Object.keys(parsed.errors)).toContain(TERM_FIELD_IDS.discountDays);
      }),
    );
  });
});
