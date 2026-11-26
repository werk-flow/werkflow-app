'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveManagerContext } from '@/lib/org/manager-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { cancelInvoiceSchema, stornoOf, type CancelInvoiceInput } from './cancel-model';
import type { InvoiceCheckFailure } from './issue-model';
import {
  discardInvoiceOriginal,
  issueUnderCheckedNumber,
  type NextIssue,
  type StoredOriginal,
} from './original';
import { readIssuedInvoice } from './reads';

// „Stornieren“ and „Korrigieren“
// (supabase/migrations/20270310090000_cancel_and_correct_issued_invoices.sql).
// The order of „Ausstellen“, through its issueUnderCheckedNumber: the server
// checks the Stornorechnung with the EN 16931 rules under the series' next
// number and today's date first and stores the original rendered under them;
// then cancel_invoice issues it with exactly that number, registers and files
// that original, marks the original invoice Storniert and, for „Korrigieren“,
// opens the correction draft, in one transaction, or refuses when another
// issue took the number meanwhile and the server checks again. If the
// original could not be stored the Stornorechnung is issued with its original
// pending, and „Beleg erstellen“ renders the same bytes again.

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_issued',
    'invoice_cancelled',
    'invoice_is_storno',
    'invoice_not_cancellable',
    'invoice_number_moved',
    'invoice_numbers_exhausted',
  ]),
);

export type CancelInvoiceResult =
  | ActionResult<{ stornoNumber: string; originalFiled: boolean; correctionId: string | null }>
  | InvoiceCheckFailure;

const cancelledSchema = z.object({
  stornoId: uuidSchema,
  stornoNumber: z.string(),
  issueDate: z.iso.date(),
  correctionId: uuidSchema.nullable(),
  originalDocumentId: uuidSchema.nullable(),
});

type CancelContext = { userId: string; orgId: string };
type CancelInput = { invoiceId: string; attemptKey: string; reason: string; correct: boolean };

/**
 * Cancels under the number and Berlin day the Stornorechnung was checked
 * under, and files the original stored for them in the same call: the
 * function refuses `invoice_number_moved` when another issue took that number
 * first. A stored original that is not the Stornorechnung's registered one is
 * discarded; after an unknown outcome it stays, as the call may commit.
 */
async function cancelChecked(
  context: CancelContext,
  input: CancelInput,
  checked: NextIssue,
  stored: StoredOriginal | null,
): Promise<CancelInvoiceResult> {
  const { data, error } = await createSupabaseAdminClient().rpc('cancel_invoice', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: input.invoiceId,
    p_attempt_key: input.attemptKey,
    p_reason: input.reason,
    p_correct: input.correct,
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
  const cancelled = cancelledSchema.safeParse(data);
  const registeredOther = cancelled.success && cancelled.data.originalDocumentId !== stored?.documentId;
  if (stored && (isConfirmedWriteRefusal(error) || registeredOther)) {
    await discardInvoiceOriginal(context.orgId, stored);
  }
  if (error || !cancelled.success) {
    return refusal(error, 'cancel_failed', 'cancelInvoice: cancel_invoice failed');
  }
  return {
    success: true,
    stornoNumber: cancelled.data.stornoNumber,
    originalFiled: cancelled.data.originalDocumentId !== null,
    correctionId: cancelled.data.correctionId,
  };
}

/**
 * Cancels an issued invoice with a Stornorechnung, which takes the series'
 * next number and is filed for ten years; the original stays as issued and
 * reads Storniert. With `correct` a new draft prefilled from the original
 * follows, linked to it.
 */
export async function cancelInvoice(rawInput: CancelInvoiceInput): Promise<CancelInvoiceResult> {
  const parsed = cancelInvoiceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManagerContext();
    if (!caller.success) return caller;
    const { context } = caller;
    const original = await readIssuedInvoice(context.orgId, input.invoiceId);
    if (!original) return { success: false, error: 'invoice_not_found' };
    if (original.cancels) return { success: false, error: 'invoice_is_storno' };
    // A credit's Stornorechnung would ask the customer to pay; the function refuses it too.
    if (original.grossCents < 0) return { success: false, error: 'invoice_not_cancellable' };
    if (!original.issue) return { success: false, error: 'invoice_not_issued' };

    const { issue } = original;
    // Storniert already: the function answers a retry of the same press with its first cancel, else
    // refuses, both before it compares a number, so the original's own stands in.
    const result =
      original.status !== 'ausgestellt'
        ? await cancelChecked(
            context,
            input,
            { number: issue.invoiceNumber, issueDate: issue.issueDate },
            null,
          )
        : await issueUnderCheckedNumber(
            context.orgId,
            { ...stornoOf({ ...original, ...issue }, input.reason), recipient: original.recipient },
            issue.snapshot,
            (next, stored) => cancelChecked(context, input, next, stored),
          );
    // The page the dialog leaves renders Storniert into this response, so Back after „Korrigieren“ shows it.
    if (result.success) revalidatePath(`/rechnungen/${input.invoiceId}`);
    return result;
  } catch (error) {
    logError('cancelInvoice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
