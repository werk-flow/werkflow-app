import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { CalculatedInvoice, InvoiceDraft, InvoiceTax } from '@/lib/invoicing/model';
import { WerkflowInvoiceFailure } from '@/lib/werkflow-billing/failure';
import type { WerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeInvoiceForIssue } from '@/lib/werkflow-billing/stripe-invoice';

// A finalized Stripe invoice in the invoice core's plain model
// (lib/invoicing/). The invoice takes Stripe's number and Stripe's amounts:
// one charge has one number and one content. Until the VAT switch every line
// is exempt under § 19 UStG.

const SMALL_BUSINESS: InvoiceTax = {
  category: 'E',
  exemptionReason: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
};

const dateOf = (seconds: number) => formatBerlinLocalDate(new Date(seconds * 1000));

/** The service period over all lines; Stripe's period ends where the next one starts, so the last day is the day before. */
function deliveryOf(lines: StripeInvoiceForIssue['lines'], issueDate: string): InvoiceDraft['delivery'] {
  if (lines.length === 0) return { kind: 'date', date: issueDate };
  const start = dateOf(Math.min(...lines.map((line) => line.periodStart)));
  const end = dateOf(Math.max(...lines.map((line) => line.periodEnd)));
  return end > start ? { kind: 'period', start, end: addLocalDays(end, -1) } : { kind: 'date', date: start };
}

/**
 * A Stripe line as quantity × unit price when the amount divides evenly,
 * otherwise as one unit of its amount. A credit, such as a proration, keeps a
 * positive price and a negative quantity, as EN 16931 wants (BR-27).
 */
function stripeLineOf(
  line: StripeInvoiceForIssue['lines'][number],
  index: number,
): InvoiceDraft['lines'][number] {
  const units = line.quantity !== null && line.amountCents % line.quantity === 0 ? line.quantity : 1;
  const sign = line.amountCents < 0 ? '-' : '';
  return {
    id: String(index + 1),
    name: line.description || 'WerkFlow',
    description: '',
    quantity: `${sign}${units}`,
    unitCode: 'C62',
    unitPriceCents: Math.abs(line.amountCents) / units,
    priceQuantity: 1,
    tax: SMALL_BUSINESS,
  };
}

/** WerkFlow's invoice draft for a finalized Stripe invoice. */
export function werkflowInvoiceDraft(
  stripe: StripeInvoiceForIssue,
  { seller, creditorId }: WerkflowSeller,
): InvoiceDraft {
  const issueDate = dateOf(stripe.finalizedAt);
  const { buyer, payment } = stripe;
  return {
    typeCode: '380',
    number: stripe.number,
    issueDate,
    currency: 'EUR',
    seller,
    buyer: {
      name: buyer.name,
      address: {
        lines: buyer.lines,
        postalCode: buyer.postalCode,
        city: buyer.city,
        countryCode: buyer.countryCode,
      },
      vatId: buyer.vatId,
      email: buyer.email,
    },
    deliverTo: null,
    delivery: deliveryOf(stripe.lines, issueDate),
    buyerReference: null,
    orderReference: null,
    precedingInvoice: null,
    paymentTerms: { dueInDays: 0, discount: null },
    payment:
      payment?.kind === 'direct-debit'
        ? { kind: 'direct-debit', mandateReference: payment.mandateReference, creditorId }
        : payment,
    paidCents: stripe.paidCents,
    notes: [],
    lines: stripe.lines.map(stripeLineOf),
  };
}

/**
 * Throws `werkflow_invoice_amount_mismatch` unless the core's amounts are
 * Stripe's: every line, net, VAT, gross, paid and due. A discount, a customer
 * balance or a tax Stripe applied shows up here and stops the issue.
 */
export function assertStripeAmounts(stripe: StripeInvoiceForIssue, invoice: CalculatedInvoice): void {
  const { totals } = invoice;
  const same =
    invoice.lines.length === stripe.lines.length &&
    invoice.lines.every((line, index) => line.netCents === stripe.lines[index]?.amountCents) &&
    totals.lineNetCents === stripe.subtotalCents &&
    totals.taxCents === stripe.taxCents &&
    totals.grossCents === stripe.totalCents &&
    totals.paidCents === stripe.paidCents &&
    totals.dueCents === stripe.remainingCents;
  if (!same) throw new WerkflowInvoiceFailure('werkflow_invoice_amount_mismatch');
}
