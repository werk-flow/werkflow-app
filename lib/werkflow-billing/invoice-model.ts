import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { CalculatedInvoice, InvoiceDraft, InvoiceTax } from '@/lib/invoicing/model';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import type { WerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeRefund } from '@/lib/werkflow-billing/stripe-credit-note';
import type { StripeInvoiceForIssue } from '@/lib/werkflow-billing/stripe-invoice';
import { formatGermanDate } from '@/lib/utils';

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

/** A refund as a line of the invoice that stays: one negative unit of the refunded amount. */
function refundLineOf(refund: StripeRefund, index: number): InvoiceDraft['lines'][number] {
  return {
    id: String(index + 1),
    name: `Erstattung ${refund.number}`,
    description: '',
    quantity: '-1',
    unitCode: 'C62',
    unitPriceCents: refund.totalCents,
    priceQuantity: 1,
    tax: SMALL_BUSINESS,
  };
}

/** The lines of the document that stands for a Stripe invoice after `refunds`: Stripe's lines, then one per refund. */
function standingLinesOf(
  stripe: StripeInvoiceForIssue,
  refunds: readonly StripeRefund[],
): InvoiceDraft['lines'] {
  const lines = stripe.lines.map(stripeLineOf);
  return [...lines, ...refunds.map((refund, index) => refundLineOf(refund, lines.length + index))];
}

function negated(line: InvoiceDraft['lines'][number]): InvoiceDraft['lines'][number] {
  const { quantity } = line;
  return { ...line, quantity: quantity.startsWith('-') ? quantity.slice(1) : `-${quantity}` };
}

/**
 * The Storno (384) of the document a refund cancels, and the replacement
 * invoice for the part that stays, or null when the refund takes it all.
 * `earlier` are the refunds the cancelled document already holds. The Storno
 * names the cancelled document, negates its lines and asks for nothing; the
 * replacement holds Stripe's lines and one line per refund, paid in full.
 */
export function werkflowStornoDrafts(
  stripe: StripeInvoiceForIssue,
  seller: WerkflowSeller,
  refunds: {
    cancelled: { number: string; issueDate: string };
    earlier: readonly StripeRefund[];
    refund: StripeRefund;
    replacementNumber: string;
  },
): { storno: InvoiceDraft; replacement: InvoiceDraft | null } {
  const { cancelled, earlier, refund } = refunds;
  const base = werkflowInvoiceDraft(stripe, seller);
  const issueDate = dateOf(refund.createdAt);
  const storno: InvoiceDraft = {
    ...base,
    typeCode: '384',
    number: refund.number,
    issueDate,
    precedingInvoice: cancelled,
    payment: null,
    paidCents: 0,
    lines: standingLinesOf(stripe, earlier).map(negated),
  };
  const standing = [...earlier, refund];
  const remainingCents = stripe.totalCents - standing.reduce((sum, entry) => sum + entry.totalCents, 0);
  if (remainingCents < 0) throw billingFailure('werkflow_invoice_amount_mismatch');
  if (remainingCents === 0) return { storno, replacement: null };
  return {
    storno,
    replacement: {
      ...base,
      number: refunds.replacementNumber,
      issueDate,
      paidCents: remainingCents,
      notes: [
        `Diese Rechnung ersetzt die Rechnung ${cancelled.number} vom ${formatGermanDate(cancelled.issueDate)}, storniert mit ${refund.number}.`,
      ],
      lines: standingLinesOf(stripe, standing),
    },
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
  if (!same) throw billingFailure('werkflow_invoice_amount_mismatch');
}
