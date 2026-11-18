'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { officeCaller } from './caller';
import { cancelInvoiceSchema, stornoOf, type CancelInvoiceInput } from './cancel-model';
import type { InvoiceCheckFailure } from './issue-model';
import { fileIssuedOriginal, findingsBeforeNumber } from './original';
import { readIssuedInvoice } from './reads';

// „Stornieren“ and „Korrigieren“
// (supabase/migrations/20261216120000_cancel_and_correct_issued_invoices.sql).
// The order of „Ausstellen“: the server checks the Stornorechnung with the
// EN 16931 rules under a placeholder number first; then cancel_invoice issues
// it with the series' next number, marks the original Storniert and, for
// „Korrigieren“, opens the correction draft, in one transaction; then the
// Stornorechnung's original is rendered and filed like any invoice's, and a
// failure there leaves it pending for „Beleg erstellen“.

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_issued',
    'invoice_cancelled',
    'invoice_is_storno',
    'invoice_not_cancellable',
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
});

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
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { context } = caller;
    const original = await readIssuedInvoice(context.orgId, input.invoiceId);
    if (!original) return { success: false, error: 'invoice_not_found' };
    if (original.cancels) return { success: false, error: 'invoice_is_storno' };
    // A credit's Stornorechnung would ask the customer to pay; the function refuses it too.
    if (original.grossCents < 0) return { success: false, error: 'invoice_not_cancellable' };
    if (!original.issue) return { success: false, error: 'invoice_not_issued' };
    // Storniert already: the function answers a retry of the same press with its first Storno, else refuses.
    if (original.status === 'ausgestellt') {
      const storno = stornoOf({ ...original, ...original.issue }, input.reason);
      const findings = await findingsBeforeNumber(
        context.orgId,
        { ...storno, recipient: original.recipient },
        original.issue.snapshot,
      );
      if (!findings) return { success: false, error: 'invoice_incomplete' };
      if (findings.length > 0) return { success: false, error: 'invoice_check_failed', findings };
    }

    const { data, error } = await createSupabaseAdminClient().rpc('cancel_invoice', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_invoice_id: input.invoiceId,
      p_attempt_key: input.attemptKey,
      p_reason: input.reason,
      p_correct: input.correct,
    });
    const cancelled = cancelledSchema.safeParse(data);
    if (error || !cancelled.success) {
      return refusal(error, 'cancel_failed', 'cancelInvoice: cancel_invoice failed');
    }

    // Cancelled from here on: a failure below leaves the Stornorechnung's original pending.
    const originalFiled = await readIssuedInvoice(context.orgId, cancelled.data.stornoId).then(
      (storno) => fileIssuedOriginal(context, storno),
      (readError: unknown) => {
        logError('cancelInvoice: Stornorechnung not read back', readError);
        return false;
      },
    );
    return {
      success: true,
      stornoNumber: cancelled.data.stornoNumber,
      originalFiled,
      correctionId: cancelled.data.correctionId,
    };
  } catch (error) {
    logError('cancelInvoice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
