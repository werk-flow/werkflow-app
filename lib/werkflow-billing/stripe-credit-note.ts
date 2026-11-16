import { billingFailure } from '@/lib/werkflow-billing/failure';
import { z } from '@/lib/zod';

// What WerkFlow's Storno takes from a Stripe credit note, read back from Stripe
// by id (lib/werkflow-billing/stripe.ts), as a plain record. WerkFlow issues a
// Storno for a refund of a paid invoice: a `post_payment` credit note. A
// credit note on an open invoice lowers what Stripe still collects and has no
// WerkFlow document yet.

export type StripeRefund = {
  id: string;
  /** Stripe's number, `<invoice number>-CN-<NN>`: the Storno takes it. */
  number: string;
  invoiceId: string;
  /** Seconds since the epoch, as Stripe counts. */
  createdAt: number;
  totalCents: number;
};

export type StripeRefundForStorno = {
  refund: StripeRefund;
  /** Every refund of its invoice in Stripe's order, this one included. */
  refunds: StripeRefund[];
};

const creditNoteSchema = z.object({
  id: z.string().regex(/^cn_[A-Za-z0-9_]{1,250}$/),
  number: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  invoice: z.union([z.string(), z.object({ id: z.string() })]),
  type: z.string(),
  status: z.string(),
  created: z.number().int().positive(),
  subtotal: z.number().int().safe(),
  total: z.number().int().positive().safe(),
});

/** One issued credit note as a refund; throws a stable code for anything else. */
function refundOf(source: unknown): StripeRefund | null {
  const parsed = creditNoteSchema.safeParse(source);
  if (!parsed.success) throw billingFailure('werkflow_invoice_unreadable');
  const note = parsed.data;
  if (note.status === 'void') return null;
  if (note.type !== 'post_payment' || note.status !== 'issued')
    throw billingFailure('werkflow_storno_unsupported');
  // Until the VAT switch nothing carries tax: a taxed credit is not WerkFlow's.
  if (note.total !== note.subtotal) throw billingFailure('werkflow_invoice_amount_mismatch');
  const invoiceId = typeof note.invoice === 'string' ? note.invoice : note.invoice.id;
  if (!/^in_[A-Za-z0-9_]{1,250}$/.test(invoiceId)) throw billingFailure('werkflow_invoice_unreadable');
  return { id: note.id, number: note.number, invoiceId, createdAt: note.created, totalCents: note.total };
}

/**
 * The credit note `creditNote` and every credit note of its invoice
 * (`creditNotes`, in any order) as refunds in Stripe's order. Throws a stable
 * code: an object it cannot read, a credit note that is not a refund of a paid
 * invoice, a taxed credit, or a list that lacks the credit note.
 */
export function stripeRefundForStorno(source: {
  creditNote: unknown;
  creditNotes: readonly unknown[];
}): StripeRefundForStorno {
  const refund = refundOf(source.creditNote);
  if (!refund) throw billingFailure('werkflow_storno_unsupported');
  const refunds = source.creditNotes
    .map(refundOf)
    .filter((entry): entry is StripeRefund => entry !== null)
    .sort((left, right) => left.createdAt - right.createdAt || left.number.localeCompare(right.number));
  if (
    refunds.some((entry) => entry.invoiceId !== refund.invoiceId) ||
    !refunds.some((entry) => entry.id === refund.id)
  ) {
    throw billingFailure('werkflow_invoice_unreadable');
  }
  return { refund, refunds };
}
