import 'server-only';

import type Stripe from 'stripe';

import { logError } from '@/lib/logging';
import { putWerkflowBillingObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { WerkflowInvoiceFailure } from '@/lib/werkflow-billing/failure';
import { type IssueDependencies, issueWerkflowInvoice } from '@/lib/werkflow-billing/issue-invoice';
import { readWerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// The issue step of WerkFlow's original (werk-flow/werkflow-planning#249,
// issue-invoice.ts) for a signal that names an invoice: `invoice.finalized`
// runs it, and `invoice.paid` runs it again as a backstop. The event names
// only the invoice id; the step reads the invoice back from Stripe, is
// idempotent through `werkflow_invoices`, and throws a stable code on failure
// so Stripe delivers again and the alarm (A6a) sees the code.

const invoiceEventSchema = z.object({
  id: z.string(),
  data: z.object({ object: z.object({ id: z.string().regex(/^in_[A-Za-z0-9_]{1,250}$/) }) }),
});

function liveDependencies(stripe: StripeGateway): IssueDependencies {
  const admin = createSupabaseAdminClient();
  return {
    readInvoice: (invoiceId) => stripe.readInvoiceForIssue(invoiceId),
    seller: () => readWerkflowSeller(),
    storeOriginal: (key, pdf) =>
      putWerkflowBillingObject({ path: key, body: pdf, contentType: 'application/pdf' }),
    isIssued: async (stripeInvoiceId) => {
      // tenant-scope: cross-organization-by-design — the Stripe invoice id is unique across organizations; this only asks whether it was issued.
      const { data, error } = await admin
        .from('werkflow_invoices')
        .select('id')
        .eq('stripe_invoice_id', stripeInvoiceId)
        .maybeSingle();
      if (error) {
        logError('issueOriginal: werkflow_invoices read failed', error);
        throw new WerkflowInvoiceFailure('werkflow_invoice_record_failed');
      }
      return data !== null;
    },
    record: async (row) => {
      // tenant-scope: cross-organization-by-design — the organization comes from the Stripe customer's metadata that WerkFlow's server set; no caller names it.
      const { data, error } = await admin.rpc('issue_werkflow_invoice', row);
      if (error) {
        logError('issueOriginal: issue_werkflow_invoice failed', error);
        throw new WerkflowInvoiceFailure(
          error.message.includes('werkflow_invoice_organization_unknown')
            ? 'werkflow_invoice_organization_unknown'
            : 'werkflow_invoice_record_failed',
        );
      }
      if (data !== 'issued' && data !== 'already_issued') {
        throw new WerkflowInvoiceFailure('werkflow_invoice_record_failed');
      }
      return data;
    },
  };
}

/** Issues the original of the invoice a verified signal names, at most once. */
export async function issueOriginalOfSignal(event: Stripe.Event, stripe: StripeGateway): Promise<void> {
  const parsed = invoiceEventSchema.safeParse(event);
  if (!parsed.success) throw new WerkflowInvoiceFailure('werkflow_invoice_unreadable');
  await issueWerkflowInvoice(
    { stripeInvoiceId: parsed.data.data.object.id, stripeEventId: parsed.data.id },
    liveDependencies(stripe),
  );
}
