import 'server-only';

import type Stripe from 'stripe';

import { logError } from '@/lib/logging';
import { putWerkflowBillingObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { billingFailure, billingFailureCode } from '@/lib/werkflow-billing/failure';
import { sendInvoiceMail } from '@/lib/werkflow-billing/invoice-mails';
import { type IssueDependencies, issueWerkflowInvoice } from '@/lib/werkflow-billing/issue-invoice';
import { raiseBillingAlarm } from '@/lib/werkflow-billing/mail-delivery';
import type { BillingAlarmFacts } from '@/lib/werkflow-billing/mails/alarm';
import { readWerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// The issue step of WerkFlow's original (werk-flow/werkflow-planning#249,
// issue-invoice.ts) for a signal that names an invoice: `invoice.finalized`
// runs it, and `invoice.paid` runs it again as a backstop. The event names
// only the invoice id; the step reads the invoice back from Stripe, is
// idempotent through `werkflow_invoices`, and throws a stable code on failure
// so Stripe delivers again. A failure a person must look at also raises the
// `invoice_check_failed` alarm (A6a), once per Stripe object and code.

// The check failed or could not run, Stripe's amounts are not the document's,
// or Stripe's object is not one WerkFlow can issue. Any other code passes by
// itself as Stripe delivers again.
const CHECK_FAILURES: ReadonlySet<string> = new Set([
  'werkflow_invoice_rules_failed',
  'werkflow_invoice_check_unavailable',
  'werkflow_invoice_render_failed',
  'werkflow_invoice_amount_mismatch',
  'werkflow_invoice_unreadable',
  'werkflow_storno_unsupported',
]);

/**
 * Runs one issue step for a Stripe invoice or credit note. A check failure
 * raises `invoice_check_failed` once per object and code, then throws on, so
 * Stripe delivers again and a replay mails nobody twice.
 */
export async function alarmedIssue<Result>(
  { stripeObjectId, facts = [] }: { stripeObjectId: string; facts?: BillingAlarmFacts },
  issue: () => Promise<Result>,
): Promise<Result> {
  try {
    return await issue();
  } catch (error) {
    const code = billingFailureCode(error);
    if (code !== null && CHECK_FAILURES.has(code)) {
      await raiseBillingAlarm({
        kind: 'invoice_check_failed',
        stripeObjectId: `${stripeObjectId}_${code}`,
        facts: [...facts, ['Fehlercode', code]],
      });
    }
    throw error;
  }
}

const invoiceEventSchema = z.object({
  id: z.string(),
  data: z.object({ object: z.object({ id: z.string().regex(/^in_[A-Za-z0-9_]{1,250}$/) }) }),
});

/** The live database, R2 and Stripe of the issue step. */
export function liveIssueDependencies(stripe: StripeGateway): IssueDependencies {
  const admin = createSupabaseAdminClient();
  return {
    readInvoice: (invoiceId) => stripe.readInvoiceForIssue(invoiceId),
    seller: () => readWerkflowSeller(),
    storeOriginal: (key, pdf) =>
      putWerkflowBillingObject({ path: key, body: pdf, contentType: 'application/pdf' }),
    isIssued: async (stripeInvoiceId) => {
      // tenant-scope: cross-organization-by-design — the Stripe invoice id is unique across organizations; this only asks whether its original was issued.
      const { data, error } = await admin
        .from('werkflow_invoices')
        .select('id')
        .eq('stripe_invoice_id', stripeInvoiceId)
        .is('stripe_credit_note_id', null)
        .maybeSingle();
      if (error) {
        logError('issueOriginal: werkflow_invoices read failed', error);
        throw billingFailure('werkflow_invoice_record_failed');
      }
      return data !== null;
    },
    record: async (row) => {
      // tenant-scope: cross-organization-by-design — the organization comes from the Stripe customer's metadata that WerkFlow's server set; no caller names it.
      const { data, error } = await admin.rpc('issue_werkflow_invoice', row);
      if (error) {
        logError('issueOriginal: issue_werkflow_invoice failed', error);
        throw billingFailure(
          error.message.includes('werkflow_invoice_organization_unknown')
            ? 'werkflow_invoice_organization_unknown'
            : 'werkflow_invoice_record_failed',
        );
      }
      if (data !== 'issued' && data !== 'already_issued') {
        throw billingFailure('werkflow_invoice_record_failed');
      }
      return data;
    },
  };
}

/**
 * Issues the original of the invoice a verified signal names, at most once,
 * then mails it to the customer once (A6b, werk-flow/werkflow-planning#492).
 */
export async function issueOriginalOfSignal(event: Stripe.Event, stripe: StripeGateway): Promise<void> {
  const parsed = invoiceEventSchema.safeParse(event);
  if (!parsed.success) throw billingFailure('werkflow_invoice_unreadable');
  const stripeInvoiceId = parsed.data.data.object.id;
  await alarmedIssue({ stripeObjectId: stripeInvoiceId }, () =>
    issueWerkflowInvoice({ stripeInvoiceId, stripeEventId: parsed.data.id }, liveIssueDependencies(stripe)),
  );
  await sendInvoiceMail(stripeInvoiceId, stripe);
}
