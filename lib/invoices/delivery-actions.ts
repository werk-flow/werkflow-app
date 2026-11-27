'use server';

import type { ActionResult } from '@/lib/action-result';
import {
  recordManualDelivery,
  retryDocumentDelivery,
  sendDocument,
  type DeliveryOutcome,
} from '@/lib/delivery/document-delivery';
import { recordManualDeliverySchema, sendDocumentEmailSchema } from '@/lib/delivery/delivery-types';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { resolveManagerContext } from '@/lib/org/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { readIssuedInvoice } from './reads';

// „Per E-Mail senden“, „Erneut senden“ and „Als manuell versendet markieren“
// on an issued invoice (lib/delivery/document-delivery.ts). Admin and Büro
// only; the attachment is always the invoice's own filed original, read on
// the server, never a document the client names.

const sendInvoiceEmailSchema = sendDocumentEmailSchema.extend({ invoiceId: uuidSchema });
const markInvoiceSentManuallySchema = recordManualDeliverySchema.extend({ invoiceId: uuidSchema });
const retryInvoiceDeliverySchema = z.object({
  deliveryId: uuidSchema,
  /** The attempt the office saw failed: a repeated press sends nothing again. */
  expectedAttempt: z.number().int().min(1),
});

/** The caller and the filed original of an issued invoice of their organization. */
async function issuedOriginal(
  invoiceId: string,
): Promise<ActionResult<{ context: ActionContext; documentId: string }>> {
  const caller = await resolveManagerContext();
  if (!caller.success) return caller;
  const invoice = await readIssuedInvoice(caller.context.orgId, invoiceId);
  if (!invoice) return { success: false, error: 'invoice_not_found' };
  if (invoice.status !== 'ausgestellt') return { success: false, error: 'invoice_not_issued' };
  if (!invoice.original?.filed) return { success: false, error: 'original_missing' };
  return { success: true, context: caller.context, documentId: invoice.original.documentId };
}

/** Sends the issued invoice's original to one recipient, once per filled form. */
export async function sendInvoiceEmail(
  rawInput: z.input<typeof sendInvoiceEmailSchema>,
): Promise<DeliveryOutcome> {
  const parsed = sendInvoiceEmailSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const target = await issuedOriginal(input.invoiceId);
    if (!target.success) return target;
    return await sendDocument(target.context, {
      attemptKey: input.attemptKey,
      subject: { kind: 'invoice', id: input.invoiceId },
      documentId: target.documentId,
      recipient: input.recipient,
      emailSubject: input.subject,
      text: input.text,
    });
  } catch (error) {
    logError('sendInvoiceEmail: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** „Erneut senden“: a failed delivery once more, with what it carried. */
export async function retryInvoiceDelivery(
  rawInput: z.input<typeof retryInvoiceDeliverySchema>,
): Promise<DeliveryOutcome> {
  const parsed = retryInvoiceDeliverySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const caller = await resolveManagerContext();
    if (!caller.success) return caller;
    return await retryDocumentDelivery(caller.context, {
      id: parsed.data.deliveryId,
      expectedAttempt: parsed.data.expectedAttempt,
      subjectKind: 'invoice',
    });
  } catch (error) {
    logError('retryInvoiceDelivery: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Records that the office sent the invoice by post or by hand. */
export async function markInvoiceSentManually(
  rawInput: z.input<typeof markInvoiceSentManuallySchema>,
): Promise<ActionResult> {
  const parsed = markInvoiceSentManuallySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const target = await issuedOriginal(input.invoiceId);
    if (!target.success) return target;
    return await recordManualDelivery(target.context, {
      attemptKey: input.attemptKey,
      subject: { kind: 'invoice', id: input.invoiceId },
      documentId: target.documentId,
      note: input.note,
    });
  } catch (error) {
    logError('markInvoiceSentManually: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
