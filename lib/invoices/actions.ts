'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import {
  createInvoiceSchema,
  deleteInvoiceDraftSchema,
  saveInvoiceDraftSchema,
  type CreateInvoiceInput,
  type DeleteInvoiceDraftInput,
  type SaveInvoiceDraftInput,
} from './action-schemas';
import { draftAmounts, type DraftAmounts } from './amounts';
import type { InvoiceLineValues } from './types';

// Admin and Büro keep the invoices. Every action resolves the caller's
// organization and manager role on the server and passes only those; the
// database function checks the actor again, refuses every id outside the
// organization and writes the history in the same call
// (supabase/migrations/20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql).
// The server computes every amount with the invoice core and stores it.

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'client_not_found',
    'client_archived',
    'work_not_found',
    'invoice_not_found',
    'invoice_not_draft',
    'stale_version',
  ]),
);

async function officeCaller() {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  return caller;
}

/** Creates a draft for a customer, optionally for one of its jobs, projects or Servicefälle. */
export async function createInvoice(
  rawInput: CreateInvoiceInput,
): Promise<ActionResult<{ invoiceId: string }>> {
  const parsed = createInvoiceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const { data, error } = await createSupabaseAdminClient().rpc(
      'create_invoice',
      rpcArgs('create_invoice', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_attempt_key: input.attemptKey,
        p_client_id: input.clientId,
        p_work_kind: input.work?.kind ?? null,
        p_work_id: input.work?.id ?? null,
      }),
    );
    if (error || !data) return refusal(error, 'save_failed', 'createInvoice: create_invoice failed');
    return { success: true, invoiceId: data };
  } catch (error) {
    logError('createInvoice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

function amountsOrNull(lines: InvoiceLineValues[]): DraftAmounts | null {
  try {
    return draftAmounts(lines);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Saves a draft's terms and lines with the amounts the server computed; answers the new version. */
export async function saveInvoiceDraft(
  rawInput: SaveInvoiceDraftInput,
): Promise<ActionResult<{ version: number }>> {
  const parsed = saveInvoiceDraftSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    // A line the line rule refuses (an amount beyond the safe range) is the office's input to fix.
    const amounts = amountsOrNull(input.lines);
    if (!amounts) return { success: false, error: 'invalid_input' };
    const { data, error } = await createSupabaseAdminClient().rpc(
      'save_invoice_draft',
      rpcArgs('save_invoice_draft', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_invoice_id: input.invoiceId,
        p_expected_version: input.expectedVersion,
        p_attempt_key: input.attemptKey,
        p_terms: input.terms,
        p_lines: input.lines.map((line, index) => ({
          ...line,
          taxCategory: line.taxRateBasisPoints === 0 ? 'Z' : 'S',
          netCents: amounts.lineNetCents[index] ?? 0,
        })),
        p_totals: amounts.totals,
      }),
    );
    if (error || data === null)
      return refusal(error, 'save_failed', 'saveInvoiceDraft: save_invoice_draft failed');
    return { success: true, version: data };
  } catch (error) {
    logError('saveInvoiceDraft: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Deletes a draft with its lines; its history stays. */
export async function deleteInvoiceDraft(rawInput: DeleteInvoiceDraftInput): Promise<ActionResult> {
  const parsed = deleteInvoiceDraftSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await officeCaller();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const { error } = await createSupabaseAdminClient().rpc('delete_invoice_draft', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_invoice_id: input.invoiceId,
      p_expected_version: input.expectedVersion,
      p_attempt_key: input.attemptKey,
    });
    if (error) return refusal(error, 'delete_failed', 'deleteInvoiceDraft: delete_invoice_draft failed');
    return { success: true };
  } catch (error) {
    logError('deleteInvoiceDraft: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
