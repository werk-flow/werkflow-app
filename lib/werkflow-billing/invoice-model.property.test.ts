import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { berlinInstantMsArbitrary } from '@/lib/testing/berlin-arbitraries';
import { assertStripeAmounts, werkflowInvoiceDraft } from './invoice-model';
import type { WerkflowSeller } from './seller';
import type { StripeInvoiceForIssue } from './stripe-invoice';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/commercial-and-finance.md, "WerkFlow's own invoices": the original carries
// Stripe's amounts, every line exempt under § 19 UStG, and is issued only when its amounts equal
// Stripe's; a tax, discount or customer balance in Stripe stops the issue.

const SELLER: WerkflowSeller = {
  seller: {
    name: 'WerkFlow Beispiel',
    address: { lines: ['Musterweg 1'], postalCode: '01234', city: 'Musterstadt', countryCode: 'DE' },
    vatId: null,
    taxNumber: '123/456/78901',
    legalRegistrationId: null,
    email: null,
  },
  creditorId: 'DE98ZZZ09999999999',
};

const stripeLineArbitrary = fc
  .record({
    amountCents: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.integer({ min: -500_000, max: -1 })),
    quantity: fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
    periodStart: berlinInstantMsArbitrary.map((ms) => Math.floor(ms / 1000)),
    days: fc.integer({ min: 0, max: 366 }),
  })
  .map(({ periodStart, days, ...line }) => ({
    ...line,
    description: 'WerkFlow Abo',
    periodStart,
    periodEnd: periodStart + days * 86_400,
  }));

/** A finalized Stripe invoice whose totals agree with its lines, as Stripe reports one without tax. */
const stripeInvoiceArbitrary: fc.Arbitrary<StripeInvoiceForIssue> = fc
  .tuple(
    fc.array(stripeLineArbitrary, { minLength: 1, maxLength: 8 }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  )
  .map(([lines, share]) => {
    const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
    const paidCents = Math.floor(Math.max(subtotalCents, 0) * share);
    const finalizedAt = Math.max(...lines.map((line) => line.periodStart));
    return {
      id: 'in_test',
      number: 'WF-0001',
      customerId: 'cus_test',
      organizationId: '00000000-0000-4000-8000-000000000001',
      finalizedAt,
      buyer: {
        name: 'Musterbetrieb',
        lines: ['Musterweg 2'],
        postalCode: '01234',
        city: 'Musterstadt',
        countryCode: 'DE',
        email: null,
        vatId: null,
      },
      lines,
      subtotalCents,
      taxCents: 0,
      totalCents: subtotalCents,
      paidCents,
      remainingCents: subtotalCents - paidCents,
      payment: null,
    };
  });

describe('WerkFlow’s own invoice from a Stripe invoice', () => {
  test('carries Stripe’s line amounts and totals, every line exempt, so the amount check passes', () => {
    fc.assert(
      fc.property(stripeInvoiceArbitrary, (stripe) => {
        const invoice = calculateInvoice(werkflowInvoiceDraft(stripe, SELLER));
        expect(invoice.lines.map((line) => line.netCents)).toEqual(
          stripe.lines.map((line) => line.amountCents),
        );
        expect(invoice.lines.every((line) => line.tax.category === 'E')).toBe(true);
        expect(invoice.totals.taxCents).toBe(0);
        expect(() => assertStripeAmounts(stripe, invoice)).not.toThrow();
      }),
    );
  });

  test('is not issued when Stripe adds tax, a discount or a balance that the lines do not show', () => {
    fc.assert(
      fc.property(
        stripeInvoiceArbitrary,
        fc.integer({ min: 1, max: 10_000 }),
        fc.constantFrom('tax', 'discount', 'balance'),
        (stripe, cents, kind) => {
          const changed: StripeInvoiceForIssue =
            kind === 'tax'
              ? {
                  ...stripe,
                  taxCents: cents,
                  totalCents: stripe.totalCents + cents,
                  remainingCents: stripe.remainingCents + cents,
                }
              : kind === 'discount'
                ? {
                    ...stripe,
                    totalCents: stripe.totalCents - cents,
                    remainingCents: stripe.remainingCents - cents,
                  }
                : { ...stripe, remainingCents: stripe.remainingCents - cents };
          const invoice = calculateInvoice(werkflowInvoiceDraft(changed, SELLER));
          expect(() => assertStripeAmounts(changed, invoice)).toThrow('werkflow_invoice_amount_mismatch');
        },
      ),
    );
  });

  test('covers a service period from the first line’s start to the day before the last line’s end', () => {
    fc.assert(
      fc.property(stripeInvoiceArbitrary, (stripe) => {
        const { delivery, issueDate } = werkflowInvoiceDraft(stripe, SELLER);
        if (delivery.kind === 'period') expect(delivery.start <= delivery.end).toBe(true);
        else expect(delivery.date <= issueDate).toBe(true);
      }),
    );
  });
});
