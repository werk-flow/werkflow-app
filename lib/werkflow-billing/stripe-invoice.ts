import { WerkflowInvoiceFailure } from '@/lib/werkflow-billing/failure';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// What WerkFlow's invoice takes from a finalized Stripe invoice, read back from
// Stripe by id (lib/werkflow-billing/stripe.ts). Stripe's objects are parsed
// here into a plain record, so the mapping and its tests need no Stripe type.
// The organization comes only from the customer's `werkflow_organization_id`
// metadata, which WerkFlow's server set.

type StripeInvoicePayment =
  | { kind: 'direct-debit'; mandateReference: string }
  | { kind: 'card'; lastFour: string };

export type StripeInvoiceForIssue = {
  id: string;
  number: string;
  customerId: string;
  organizationId: string;
  /** Seconds since the epoch, as Stripe counts. */
  finalizedAt: number;
  buyer: {
    name: string;
    lines: string[];
    postalCode: string;
    city: string;
    countryCode: string;
    email: string | null;
    vatId: string | null;
  };
  lines: Array<{
    description: string;
    amountCents: number;
    quantity: number | null;
    periodStart: number;
    periodEnd: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  payment: StripeInvoicePayment | null;
};

const cents = z.number().int().safe();
const text = z.string().nullish();

const invoiceSchema = z.object({
  id: z.string().regex(/^in_[A-Za-z0-9_]{1,250}$/),
  status: z.string().nullable(),
  number: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .nullable(),
  currency: z.string(),
  customer: z.object({
    id: z.string().regex(/^cus_[A-Za-z0-9_]{1,250}$/),
    metadata: z.record(z.string(), z.string()).nullish(),
  }),
  customer_name: text,
  customer_email: text,
  customer_address: z
    .object({ line1: text, line2: text, postal_code: text, city: text, country: text })
    .nullish(),
  customer_tax_ids: z.array(z.object({ type: z.string(), value: text })).nullish(),
  status_transitions: z.object({ finalized_at: z.number().int().positive().nullable() }),
  subtotal: cents,
  total: cents,
  total_taxes: z.array(z.object({ amount: cents })).nullish(),
  amount_paid: cents,
  amount_remaining: cents,
});

const lineSchema = z.object({
  description: text,
  amount: cents,
  quantity: z.number().int().positive().nullish(),
  period: z.object({ start: z.number().int(), end: z.number().int() }),
});

const paymentMethodSchema = z.union([
  z.object({ type: z.literal('sepa_debit') }),
  z.object({ type: z.literal('card'), card: z.object({ last4: z.string().regex(/^\d{4}$/) }) }),
]);

const mandateReferenceSchema = z.string().regex(/^[A-Za-z0-9+?/:().,' -]{1,35}$/);

/** The buyer's EU VAT id from Stripe's frozen tax ids, if any. */
function vatIdOf(taxIds: z.infer<typeof invoiceSchema>['customer_tax_ids']): string | null {
  return taxIds?.find((taxId) => taxId.type === 'eu_vat' && taxId.value)?.value ?? null;
}

function stripePaymentOf(method: unknown, mandateReference: unknown): StripeInvoicePayment | null {
  if (method === null) return null;
  const parsed = paymentMethodSchema.safeParse(method);
  if (!parsed.success) throw new WerkflowInvoiceFailure('werkflow_invoice_unreadable');
  if (parsed.data.type === 'card') return { kind: 'card', lastFour: parsed.data.card.last4 };
  const reference = mandateReferenceSchema.safeParse(mandateReference);
  if (!reference.success) throw new WerkflowInvoiceFailure('werkflow_invoice_unreadable');
  return { kind: 'direct-debit', mandateReference: reference.data };
}

/**
 * The finalized invoice as WerkFlow issues it. `invoice` is Stripe's invoice
 * with its customer expanded, `lines` all its line items, `paymentMethod` the
 * payment method Stripe debits (null while none is known) and
 * `mandateReference` the reference of its SEPA mandate. Throws a stable code:
 * an object it cannot read, a draft, a customer without an organization, or an
 * amount due without a payment method (Stripe delivers the signal again, and
 * `invoice.paid` issues it too).
 */
export function stripeInvoiceForIssue(source: {
  invoice: unknown;
  lines: readonly unknown[];
  paymentMethod: unknown;
  mandateReference: unknown;
}): StripeInvoiceForIssue {
  const parsed = invoiceSchema.safeParse(source.invoice);
  const lines = z.array(lineSchema).safeParse(source.lines);
  if (!parsed.success || !lines.success) throw new WerkflowInvoiceFailure('werkflow_invoice_unreadable');
  const invoice = parsed.data;
  const finalizedAt = invoice.status_transitions.finalized_at;
  if (invoice.status === 'draft' || !invoice.number || !finalizedAt || invoice.currency !== 'eur') {
    throw new WerkflowInvoiceFailure('werkflow_invoice_not_finalized');
  }
  const organizationId = uuidSchema.safeParse(invoice.customer.metadata?.werkflow_organization_id);
  if (!organizationId.success) throw new WerkflowInvoiceFailure('werkflow_invoice_organization_unknown');
  const payment = stripePaymentOf(source.paymentMethod, source.mandateReference);
  if (!payment && invoice.amount_remaining > 0)
    throw new WerkflowInvoiceFailure('werkflow_invoice_payment_pending');

  const address = invoice.customer_address;
  return {
    id: invoice.id,
    number: invoice.number,
    customerId: invoice.customer.id,
    organizationId: organizationId.data,
    finalizedAt,
    buyer: {
      name: invoice.customer_name ?? '',
      lines: [address?.line1, address?.line2].filter((line): line is string => Boolean(line)),
      postalCode: address?.postal_code ?? '',
      city: address?.city ?? '',
      countryCode: address?.country ?? '',
      email: invoice.customer_email ?? null,
      vatId: vatIdOf(invoice.customer_tax_ids),
    },
    lines: lines.data.map((line) => ({
      description: line.description ?? '',
      amountCents: line.amount,
      quantity: line.quantity ?? null,
      periodStart: line.period.start,
      periodEnd: line.period.end,
    })),
    subtotalCents: invoice.subtotal,
    taxCents: (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0),
    totalCents: invoice.total,
    paidCents: invoice.amount_paid,
    remainingCents: invoice.amount_remaining,
    payment,
  };
}
