'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { checkEn16931 } from '@/lib/invoicing/check-en16931';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import {
  fileInvoiceOriginalSchema,
  issueInvoiceSchema,
  type FileInvoiceOriginalInput,
  type IssueInvoiceInput,
} from './action-schemas';
import { officeCaller } from './caller';
import { issueFindingsOf, type IssueFinding, type IssueSnapshot } from './issue-model';
import { completenessFindings, snapshotOf } from './issue-sources';
import { calculatedInvoiceOf, fileInvoiceOriginalFor, renderInvoicePdf } from './original';
import { readIssuedInvoice } from './reads';

// „Ausstellen“ (supabase/migrations/20261216100000_issue_invoices_with_gapless_numbers.sql).
// Order of work: the server builds the invoice from the draft and one
// company-profile snapshot and runs the EN 16931 rules under a placeholder
// number; a refusal answers the fields at fault and the draft stays a draft.
// Then issue_invoice assigns the number and freezes the invoice in one
// transaction. Then the original is rendered, stored, registered and filed;
// if that fails the invoice stays issued with its original pending, and
// „Beleg erstellen“ renders the same bytes again.

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_draft',
    'stale_version',
    'invoice_incomplete',
  ]),
);

const HEAD_TOO_TALL: IssueFinding = {
  label:
    'Der Briefkopf lässt keinen Platz für die Positionen: kürze Bestellnummer oder Referenz, oder verkleinere die Ränder des Briefpapiers',
  href: '/einstellungen/dokumente',
};

/** A draft that fails the check: what is wrong, in the office's words. */
type InvoiceCheckFailure = ActionFailure<'invoice_check_failed'> & { findings: IssueFinding[] };

export type IssueInvoiceResult =
  | ActionResult<{ invoiceNumber: string; originalFiled: boolean }>
  | InvoiceCheckFailure;

const issuedSchema = z.object({
  invoiceNumber: z.string(),
  issueDate: z.iso.date(),
  version: z.number().int(),
});

/**
 * Issues a checked draft: the next number of the series, frozen for good, its
 * original filed for ten years. A draft that fails the check stays a draft
 * and the answer names what is wrong.
 */
export async function issueInvoice(rawInput: IssueInvoiceInput): Promise<IssueInvoiceResult> {
  const parsed = issueInvoiceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { context } = caller;
    const admin = createSupabaseAdminClient();
    const invoice = await readIssuedInvoice(context.orgId, input.invoiceId);
    if (!invoice) return { success: false, error: 'invoice_not_found' };
    // Issued already: the function answers a retry of the same press with its first issue, else refuses.
    if (invoice.issue) return await issueChecked(admin, context, input, invoice.issue.snapshot);
    if (invoice.status !== 'entwurf') return { success: false, error: 'invoice_not_draft' };
    if (invoice.version !== input.expectedVersion) return { success: false, error: 'stale_version' };

    const missing = completenessFindings(invoice);
    if (missing.length > 0) return { success: false, error: 'invoice_check_failed', findings: missing };
    const snapshot = await snapshotOf(admin, context, invoice);
    if (!snapshot) return { success: false, error: 'load_failed' };
    const calculated = calculatedInvoiceOf(invoice, snapshot, {
      number: 'ENTWURF',
      issueDate: getBusinessTodayIso(),
    });
    if (!calculated) return { success: false, error: 'invoice_incomplete' };
    const xml = toEn16931(calculated);
    const check = await checkEn16931(xml);
    if (!check.valid) {
      return {
        success: false,
        error: 'invoice_check_failed',
        findings: issueFindingsOf(check.errors, invoice.recipient.id),
      };
    }
    // The original must render too: a head with no room for the lines is refused before the number.
    const units = invoice.lines.map((line) => line.unit);
    const rendered = await renderInvoicePdf(context.orgId, { calculated, units, snapshot }, xml).catch(
      (renderError: unknown) => {
        if (renderError instanceof RangeError) return null;
        throw renderError;
      },
    );
    if (!rendered) return { success: false, error: 'invoice_check_failed', findings: [HEAD_TOO_TALL] };

    return await issueChecked(admin, context, input, snapshot);
  } catch (error) {
    logError('issueInvoice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Assigns the number and freezes the checked draft, then files its original. */
async function issueChecked(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  context: { userId: string; orgId: string },
  input: { invoiceId: string; expectedVersion: number; attemptKey: string },
  snapshot: IssueSnapshot,
): Promise<IssueInvoiceResult> {
  const { data, error } = await admin.rpc('issue_invoice', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: input.invoiceId,
    p_expected_version: input.expectedVersion,
    p_attempt_key: input.attemptKey,
    p_snapshot: toJson(snapshot),
  });
  const issued = issuedSchema.safeParse(data);
  if (error || !issued.success) return refusal(error, 'issue_failed', 'issueInvoice: issue_invoice failed');

  // Issued from here on: a failure below leaves the original pending, never the answer failed.
  // The original is drawn from the invoice as stored: number, date and snapshot.
  const originalFiled = await readIssuedInvoice(context.orgId, input.invoiceId).then(
    (stored) => fileOriginal(context, stored),
    (readError: unknown) => {
      logError('issueInvoice: issued invoice not read back', readError);
      return false;
    },
  );
  return { success: true, invoiceNumber: issued.data.invoiceNumber, originalFiled };
}

type ReadInvoice = Awaited<ReturnType<typeof readIssuedInvoice>>;

/** Files the original of an issued invoice; a failure leaves it pending and is logged. */
async function fileOriginal(
  context: { userId: string; orgId: string },
  issued: ReadInvoice,
): Promise<boolean> {
  try {
    if (!issued?.issue) return false;
    return await fileInvoiceOriginalFor(createSupabaseAdminClient(), context, { ...issued, ...issued.issue });
  } catch (error) {
    logError('issueInvoice: original not filed', error);
    return false;
  }
}

/** „Beleg erstellen“: renders, registers and files the original an issued invoice still lacks. */
export async function fileInvoiceOriginal(rawInput: FileInvoiceOriginalInput): Promise<ActionResult> {
  const parsed = fileInvoiceOriginalSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const invoice = await readIssuedInvoice(caller.context.orgId, parsed.data.invoiceId);
    if (!invoice) return { success: false, error: 'invoice_not_found' };
    if (!invoice.issue) return { success: false, error: 'invoice_not_issued' };
    return (await fileOriginal(caller.context, invoice))
      ? { success: true }
      : { success: false, error: 'original_failed' };
  } catch (error) {
    logError('fileInvoiceOriginal: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
