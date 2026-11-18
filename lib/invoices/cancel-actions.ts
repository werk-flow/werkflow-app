'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
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
import { readInvoiceSettings } from './settings-reads';

// „Stornieren“ and „Korrigieren“
// (supabase/migrations/20261216120000_cancel_and_correct_issued_invoices.sql).
// The order of „Ausstellen“: the server checks the Stornorechnung with the
// EN 16931 rules under the series' next number and today's date first; then
// cancel_invoice issues it with exactly that number, or refuses when another
// issue took it meanwhile and the server checks again; marks the original
// Storniert and, for
// „Korrigieren“, opens the correction draft, in one transaction; then the
// Stornorechnung's original is rendered and filed like any invoice's, and a
// failure there leaves it pending for „Beleg erstellen“.

function isMovedNumber(call: Awaited<ReturnType<typeof checkedCancel>>): boolean {
  return !('success' in call) && call.error?.message === 'invoice_number_moved';
}

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_issued',
    'invoice_cancelled',
    'invoice_is_storno',
    'invoice_not_cancellable',
    'invoice_number_moved',
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

type CancelContext = { userId: string; orgId: string };
type CancelSource = NonNullable<Awaited<ReturnType<typeof readIssuedInvoice>>>;
type CancelCall = { data: unknown; error: Parameters<typeof refusal>[0] };

/** A cancel whose checked number another issue took meanwhile is checked again, this often at most. */
const CANCEL_ATTEMPTS = 3;

/**
 * Checks the Stornorechnung of an issued `original` under the exact number and
 * Berlin day the series gives it now, then cancels with both: the function
 * refuses `invoice_number_moved` when another issue took that number first.
 * A Storniert original skips the check, so a retried press reaches the replay.
 */
async function checkedCancel(
  context: CancelContext,
  input: { invoiceId: string; attemptKey: string; reason: string; correct: boolean },
  original: CancelSource,
): Promise<CancelCall | InvoiceCheckFailure | ActionFailure<'invoice_incomplete'>> {
  const issue = {
    number: (await readInvoiceSettings(context.orgId)).nextInvoiceNumber,
    issueDate: getBusinessTodayIso(),
  };
  if (original.status === 'ausgestellt' && original.issue) {
    const storno = stornoOf({ ...original, ...original.issue }, input.reason);
    const findings = await findingsBeforeNumber(
      context.orgId,
      { ...storno, recipient: original.recipient },
      original.issue.snapshot,
      issue,
    );
    if (!findings) return { success: false, error: 'invoice_incomplete' };
    if (findings.length > 0) return { success: false, error: 'invoice_check_failed', findings };
  }
  return createSupabaseAdminClient().rpc('cancel_invoice', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: input.invoiceId,
    p_attempt_key: input.attemptKey,
    p_reason: input.reason,
    p_correct: input.correct,
    p_expected_number: issue.number,
    p_expected_issue_date: issue.issueDate,
  });
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
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { context } = caller;
    const original = await readIssuedInvoice(context.orgId, input.invoiceId);
    if (!original) return { success: false, error: 'invoice_not_found' };
    if (original.cancels) return { success: false, error: 'invoice_is_storno' };
    // A credit's Stornorechnung would ask the customer to pay; the function refuses it too.
    if (original.grossCents < 0) return { success: false, error: 'invoice_not_cancellable' };
    if (!original.issue) return { success: false, error: 'invoice_not_issued' };

    let call = await checkedCancel(context, input, original);
    for (let attempt = 1; attempt < CANCEL_ATTEMPTS && isMovedNumber(call); attempt += 1) {
      call = await checkedCancel(context, input, original);
    }
    if ('success' in call) return call;
    const cancelled = cancelledSchema.safeParse(call.data);
    if (call.error || !cancelled.success) {
      return refusal(call.error, 'cancel_failed', 'cancelInvoice: cancel_invoice failed');
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
