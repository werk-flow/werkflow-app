'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import {
  fileInvoiceOriginalSchema,
  issueInvoiceSchema,
  type FileInvoiceOriginalInput,
  type IssueInvoiceInput,
} from './action-schemas';
import { resolveManagerContext } from '@/lib/org/manager-context';
import type { InvoiceCheckFailure, IssueSnapshot } from './issue-model';
import { completenessFindings, readIssueSnapshot } from './issue-sources';
import {
  discardInvoiceOriginal,
  fileInvoiceOriginalFor,
  issueUnderCheckedNumber,
  type NextIssue,
  type StoredOriginal,
} from './original';
import { readIssuedInvoice } from './reads';

// „Ausstellen“ (supabase/migrations/20261219120000_issue_invoices_with_gapless_numbers.sql).
// Order of work: the server builds the invoice from the draft and one
// company-profile snapshot and runs the EN 16931 rules and the renderer under
// the series' next number and today's date; a refusal answers the fields at
// fault and the draft stays a draft. The original rendered under them is
// stored, and issue_invoice assigns exactly that number and date, freezes the
// invoice and registers and files the original in one transaction, or
// refuses when another issue took the number meanwhile, and the server checks
// again. If the original could not be stored the invoice is issued with its
// original pending, and „Beleg erstellen“ renders the same bytes again.

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_draft',
    'stale_version',
    'invoice_incomplete',
    'invoice_number_moved',
  ]),
);

export type IssueInvoiceResult =
  | ActionResult<{ invoiceNumber: string; originalFiled: boolean }>
  | InvoiceCheckFailure;

const issuedSchema = z.object({
  invoiceNumber: z.string(),
  issueDate: z.iso.date(),
  version: z.number().int(),
  originalDocumentId: uuidSchema.nullable(),
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
    const caller = await resolveManagerContext();
    if (!caller.success) return caller;
    const { context } = caller;
    const admin = createSupabaseAdminClient();
    const invoice = await readIssuedInvoice(context.orgId, input.invoiceId);
    if (!invoice) return { success: false, error: 'invoice_not_found' };
    // Issued already: the function answers a retry of the same press with its first issue, else refuses.
    if (invoice.issue) {
      const { snapshot, invoiceNumber, issueDate } = invoice.issue;
      return await issueChecked(admin, context, input, snapshot, { number: invoiceNumber, issueDate }, null);
    }
    if (invoice.status !== 'entwurf') return { success: false, error: 'invoice_not_draft' };
    if (invoice.version !== input.expectedVersion) return { success: false, error: 'stale_version' };

    const missing = completenessFindings(invoice);
    if (missing.length > 0) return { success: false, error: 'invoice_check_failed', findings: missing };
    const snapshot = await readIssueSnapshot(admin, context, invoice);
    if (!snapshot) return { success: false, error: 'load_failed' };
    return await issueUnderCheckedNumber(context.orgId, invoice, snapshot, (next, stored) =>
      issueChecked(admin, context, input, snapshot, next, stored),
    );
  } catch (error) {
    logError('issueInvoice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Assigns the checked number and date, freezes the checked draft and files
 * the original stored for them in one call. A stored original that is not the invoice's registered one is
 * discarded; after an unknown outcome it stays, as the call may commit.
 */
async function issueChecked(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  context: { userId: string; orgId: string },
  input: { invoiceId: string; expectedVersion: number; attemptKey: string },
  snapshot: IssueSnapshot,
  checked: NextIssue,
  stored: StoredOriginal | null,
): Promise<IssueInvoiceResult> {
  const { data, error } = await admin.rpc('issue_invoice', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: input.invoiceId,
    p_expected_version: input.expectedVersion,
    p_attempt_key: input.attemptKey,
    p_snapshot: toJson(snapshot),
    p_expected_number: checked.number,
    p_expected_issue_date: checked.issueDate,
    ...(stored && {
      p_original_document_id: stored.documentId,
      p_original_storage_path: stored.path,
      p_original_file_name: stored.fileName,
      p_original_size_bytes: stored.sizeBytes,
      p_original_content_hash: stored.contentHash,
    }),
  });
  const issued = issuedSchema.safeParse(data);
  const registeredOther = issued.success && issued.data.originalDocumentId !== stored?.documentId;
  if (stored && (isConfirmedWriteRefusal(error) || registeredOther)) {
    await discardInvoiceOriginal(context.orgId, stored);
  }
  if (error || !issued.success) return refusal(error, 'issue_failed', 'issueInvoice: issue_invoice failed');
  return {
    success: true,
    invoiceNumber: issued.data.invoiceNumber,
    originalFiled: issued.data.originalDocumentId !== null,
  };
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
    logError('fileInvoiceOriginal: original not filed', error);
    return false;
  }
}

/** „Beleg erstellen“: renders, registers and files the original an issued invoice still lacks. */
export async function fileInvoiceOriginal(rawInput: FileInvoiceOriginalInput): Promise<ActionResult> {
  const parsed = fileInvoiceOriginalSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const caller = await resolveManagerContext();
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
