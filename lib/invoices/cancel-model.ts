import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { InvoiceDetail } from './types';

// The Stornorechnung of an issued invoice as cancel_invoice stores it
// (supabase/migrations/20261216120000_cancel_and_correct_issued_invoices.sql):
// the original's lines with each quantity negated, its Leistungszeitraum and
// references, nothing due, the reason, and the invoice it cancels. The server
// checks this shape with the EN 16931 rules before the function gives it a
// number; the stored Stornorechnung renders from the same values.

/** The longest reason the office gives for a Storno; it is printed on the Stornorechnung. */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export const cancelInvoiceSchema = z.object({
  invoiceId: uuidSchema,
  /** One key per opening of the dialog: a retried press answers with the first Storno. */
  attemptKey: uuidSchema,
  reason: z.string().trim().min(1).max(CANCELLATION_REASON_MAX_LENGTH),
  /** „Korrigieren“: also open a new draft prefilled from the cancelled invoice. */
  correct: z.boolean(),
});
export type CancelInvoiceInput = z.input<typeof cancelInvoiceSchema>;

/** `1.500` → `-1.500`, `-1` → `1`; a zero stays as it is. */
export function negatedQuantity(quantity: string): string {
  if (quantity.startsWith('-')) return quantity.slice(1);
  return /^0*(?:\.0*)?$/.test(quantity) ? quantity : `-${quantity}`;
}

/** The negated amount; zero stays zero, never -0. */
function negatedCents(cents: number): number {
  return cents === 0 ? 0 : -cents;
}

type StornoSource = Pick<
  InvoiceDetail,
  | 'id'
  | 'serviceStart'
  | 'serviceEnd'
  | 'orderReference'
  | 'buyerReference'
  | 'lines'
  | 'lineNetCents'
  | 'taxCents'
  | 'grossCents'
> & { invoiceNumber: string; issueDate: string };

/** The terms, lines, totals and links of a Stornorechnung. */
type StornoFacts = Omit<StornoSource, 'id' | 'invoiceNumber' | 'issueDate'> &
  Pick<
    InvoiceDetail,
    | 'paymentDueDays'
    | 'discountDays'
    | 'discountBasisPoints'
    | 'openingText'
    | 'closingText'
    | 'cancels'
    | 'cancellationReason'
  >;

/** What the Stornorechnung of `original` holds, as cancel_invoice copies it. */
export function stornoOf(original: StornoSource, reason: string): StornoFacts {
  return {
    serviceStart: original.serviceStart,
    serviceEnd: original.serviceEnd,
    paymentDueDays: 0,
    discountDays: null,
    discountBasisPoints: null,
    orderReference: original.orderReference,
    buyerReference: original.buyerReference,
    openingText: '',
    closingText: '',
    lines: original.lines.map((line) => ({
      ...line,
      quantity: negatedQuantity(line.quantity),
      netCents: negatedCents(line.netCents),
    })),
    lineNetCents: negatedCents(original.lineNetCents),
    taxCents: negatedCents(original.taxCents),
    grossCents: negatedCents(original.grossCents),
    cancels: { id: original.id, invoiceNumber: original.invoiceNumber, issueDate: original.issueDate },
    cancellationReason: reason,
  };
}
