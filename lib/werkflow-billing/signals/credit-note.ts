import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { billingFailure, werkflowInvoiceReadFailed } from '@/lib/werkflow-billing/failure';
import { issueWerkflowStorno, type StornoDependencies } from '@/lib/werkflow-billing/issue-storno';
import { sendRefundMail } from '@/lib/werkflow-billing/refund-mail';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { alarmedIssue, liveIssueDependencies } from '@/lib/werkflow-billing/signals/issue-original';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// A Stripe credit note, the refund of a paid WerkFlow invoice, becomes its
// Stornorechnung and, for a partial refund, a replacement invoice
// (werk-flow/werkflow-planning#491, issue-storno.ts). Contract (family.ts):
// the handler re-reads the credit note and its invoice from Stripe by id, is
// idempotent through `werkflow_invoices`, and throws a stable code on failure
// so Stripe delivers again; a check failure also raises the alarm once. Once
// the credit note's Storno stands, issued now or before, the customer gets its
// refund mail (refund-mail.ts), at most once, so a delivery after a refused
// send sends it then.

const creditNoteEventSchema = z.object({
  id: z.string(),
  data: z.object({ object: z.object({ id: z.string().regex(/^cn_[A-Za-z0-9_]{1,250}$/) }) }),
});

// The original and two documents per refund: far beyond the refunds of one monthly invoice.
const DOCUMENTS_CAP = 200;

const documentSchema = z.object({
  id: z.string(),
  number: z.string(),
  issue_date: z.string(),
  type_code: z.enum(['380', '384']),
  gross_cents: z.number().int(),
  stripe_credit_note_id: z.string().nullable(),
});

function liveStornoDependencies(stripe: StripeGateway): StornoDependencies {
  const admin = createSupabaseAdminClient();
  const { readInvoice, seller, storeOriginal } = liveIssueDependencies(stripe);
  return {
    readInvoice,
    seller,
    storeOriginal,
    readRefund: (creditNoteId) => stripe.readRefundForStorno(creditNoteId),
    isIssued: async (creditNoteId) => {
      // tenant-scope: cross-organization-by-design — a Stripe credit note id is unique across organizations; this only asks whether its Storno was issued.
      const { data, error } = await admin
        .from('werkflow_invoices')
        .select('id')
        .eq('stripe_credit_note_id', creditNoteId)
        .eq('type_code', '384')
        .maybeSingle();
      if (error) werkflowInvoiceReadFailed('creditNoteSignals', error);
      return data !== null;
    },
    documents: async (stripeInvoiceId) => {
      // tenant-scope: cross-organization-by-design — the documents of one Stripe invoice, which belongs to one organization through the customer's metadata.
      const { data, error } = await admin
        .from('werkflow_invoices')
        .select('id, number, issue_date, type_code, gross_cents, stripe_credit_note_id')
        .eq('stripe_invoice_id', stripeInvoiceId)
        .limit(DOCUMENTS_CAP + 1);
      if (error) werkflowInvoiceReadFailed('creditNoteSignals', error);
      const rows = z.array(documentSchema).safeParse(data);
      if (!rows.success) throw billingFailure('werkflow_invoice_record_failed');
      if (rows.data.length > DOCUMENTS_CAP) throw billingFailure('werkflow_storno_documents_overflow');
      return rows.data.map((row) => ({
        id: row.id,
        number: row.number,
        issueDate: row.issue_date,
        typeCode: row.type_code,
        grossCents: row.gross_cents,
        stripeCreditNoteId: row.stripe_credit_note_id,
      }));
    },
    alarmed: (creditNoteId, step) =>
      alarmedIssue(
        { stripeObjectId: creditNoteId, facts: [['Beleg', 'Stornorechnung zu einer Stripe-Gutschrift']] },
        step,
      ),
    record: async (row) => {
      // tenant-scope: cross-organization-by-design — the organization comes from the Stripe customer's metadata that WerkFlow's server set, and the database refuses a cancelled row of another.
      const { data, error } = await admin.rpc('issue_werkflow_storno', row);
      if (error) {
        logError('creditNoteSignals: issue_werkflow_storno failed', error);
        throw billingFailure(
          error.message.includes('werkflow_storno_amount_mismatch')
            ? 'werkflow_invoice_amount_mismatch'
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

export const creditNoteSignals: SignalFamily = {
  eventTypes: ['credit_note.created'],
  handle: async (event, stripe) => {
    const parsed = creditNoteEventSchema.safeParse(event);
    if (!parsed.success) throw billingFailure('werkflow_invoice_unreadable');
    const stripeCreditNoteId = parsed.data.data.object.id;
    await issueWerkflowStorno(
      { stripeCreditNoteId, stripeEventId: parsed.data.id },
      liveStornoDependencies(stripe),
    );
    await sendRefundMail(stripeCreditNoteId, stripe);
  },
};
