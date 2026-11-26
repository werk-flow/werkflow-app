import 'server-only';

import { readWerkflowBillingObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { billingFailure, werkflowInvoiceReadFailed } from '@/lib/werkflow-billing/failure';
import {
  deliverCustomerBillingMail,
  describeCustomerMail,
  raiseBillingAlarm,
} from '@/lib/werkflow-billing/mail-delivery';
import { renderRefundMail } from '@/lib/werkflow-billing/mails/refund';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The refund mail (werk-flow/werkflow-planning#497): once a Stripe credit note
// has its Stornorechnung, and for a partial refund its replacement invoice
// (issue-storno.ts), the customer's billing contact gets one mail with both
// PDFs, once per credit note through the mail ledger. It renders from the
// issued rows only, which never change, so a retry after a lost answer sends
// the same content under the same key and Resend delivers it once. A refused
// send stays `failed` and throws, so Stripe delivers the signal again.
//
// The alarm order of the invoice mails (werk-flow/werkflow-planning#492): the
// customer mail goes first, an alarm after it. A permanent refusal raises
// `mail_failed` in deliverCustomerBillingMail after the send; a mail that
// cannot go at all raises it here, and nothing went out before it.

const documentSchema = z.object({
  organization_id: uuidSchema,
  number: z.string().min(1),
  type_code: z.enum(['380', '384']),
  gross_cents: z.number().int(),
  file_key: z.string().min(1),
  stripe_customer_id: z.string().min(1),
  storno_of_invoice_id: uuidSchema.nullable(),
}) satisfies z.ZodType<
  Pick<
    Tables<'werkflow_invoices'>,
    | 'organization_id'
    | 'number'
    | 'type_code'
    | 'gross_cents'
    | 'file_key'
    | 'stripe_customer_id'
    | 'storno_of_invoice_id'
  >
>;

const cancelledSchema = z.object({ number: z.string().min(1) }) satisfies z.ZodType<
  Pick<Tables<'werkflow_invoices'>, 'number'>
>;

/** The Storno of the credit note, its replacement if any, and the number of the document it cancels. */
async function refundDocuments(stripeCreditNoteId: string) {
  const admin = createSupabaseAdminClient();
  // tenant-scope: cross-organization-by-design — a Stripe credit note id is unique across organizations and issues at most a Storno and a replacement (werkflow_invoices_credit_note_idx).
  const { data, error } = await admin
    .from('werkflow_invoices')
    .select(
      'organization_id, number, type_code, gross_cents, file_key, stripe_customer_id, storno_of_invoice_id',
    )
    .eq('stripe_credit_note_id', stripeCreditNoteId)
    .limit(2);
  if (error) werkflowInvoiceReadFailed('refundMail', error);
  const rows = z.array(documentSchema).safeParse(data);
  if (!rows.success) werkflowInvoiceReadFailed('refundMail', rows.error);
  const storno = rows.data.find((row) => row.type_code === '384');
  // Called after the issue step, which issued the Storno or found it issued.
  if (!storno?.storno_of_invoice_id) throw billingFailure('werkflow_storno_not_issued');
  const replacement = rows.data.find((row) => row.type_code === '380') ?? null;

  // tenant-scope: cross-organization-by-design — the cancelled row's id comes from the Storno row, which the database ties to the same organization.
  const { data: cancelledRow, error: cancelledError } = await admin
    .from('werkflow_invoices')
    .select('number')
    .eq('id', storno.storno_of_invoice_id)
    .maybeSingle();
  if (cancelledError) werkflowInvoiceReadFailed('refundMail', cancelledError);
  const cancelled = cancelledSchema.safeParse(cancelledRow);
  if (!cancelled.success) werkflowInvoiceReadFailed('refundMail', cancelled.error);
  return { storno, replacement, cancelledNumber: cancelled.data.number };
}

/** The refund mail of one credit note with its Storno and any replacement, once; called after the issue step. */
export async function sendRefundMail(stripeCreditNoteId: string, stripe: StripeGateway): Promise<void> {
  const { storno, replacement, cancelledNumber } = await refundDocuments(stripeCreditNoteId);
  const documents = [
    { filename: `WerkFlow-Stornorechnung-${storno.number}.pdf`, fileKey: storno.file_key },
    ...(replacement
      ? [{ filename: `WerkFlow-Rechnung-${replacement.number}.pdf`, fileKey: replacement.file_key }]
      : []),
  ];
  const attachments = await Promise.all(
    documents.map(async ({ filename, fileKey }) => ({
      filename,
      content: await readWerkflowBillingObject(fileKey),
      contentType: 'application/pdf',
    })),
  );
  const outcome = await deliverCustomerBillingMail({
    kind: 'refund',
    customer: await stripe.readCustomer(storno.stripe_customer_id),
    stripeObjectId: stripeCreditNoteId,
    mail: renderRefundMail({
      stornoNumber: storno.number,
      cancelledNumber,
      // The Storno negates the cancelled document; the replacement keeps what stays.
      refundedCents: -storno.gross_cents - (replacement?.gross_cents ?? 0),
      replacement: replacement ? { number: replacement.number, grossCents: replacement.gross_cents } : null,
    }),
    attachments,
  });
  if (outcome.status === 'not_sent') {
    // No address or organization in Stripe: a person sends the Storno another way.
    await raiseBillingAlarm({
      kind: 'mail_failed',
      stripeObjectId: `${stripeCreditNoteId}_${outcome.code}`,
      facts: [
        ['Organisation', storno.organization_id],
        ['Mail', 'refund'],
        ['Grund', describeCustomerMail(outcome)],
      ],
    });
    return;
  }
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
}
