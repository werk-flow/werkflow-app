'use server';

import type { ActionResult } from '@/lib/action-result';
import {
  retryDocumentDelivery,
  sendDocument,
  type DeliveryOutcome,
  type RetryOutcome,
} from '@/lib/delivery/document-delivery';
import { sendDocumentEmailSchema } from '@/lib/delivery/delivery-types';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { resolveManagerContext } from '@/lib/org/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import { readDeliveryRevision } from './delivery';
import { offerRevisionRefSchema } from './delivery-types';

// „Per E-Mail senden“ and „Erneut senden“ for a sent offer revision, through
// E2c's delivery (lib/delivery/). Admin and Büro only; the attachment is
// always the revision's own filed PDF, read on the server, never one the
// client names. A revision a later one replaced is not sent again.

const sendOfferRevisionEmailSchema = sendDocumentEmailSchema.extend(offerRevisionRefSchema.shape);
const retryOfferRevisionDeliverySchema = z.object({
  deliveryId: uuidSchema,
  /** The attempt the office saw failed: a repeated press sends nothing again. */
  expectedAttempt: z.number().int().min(1),
});

/**
 * The caller, and the id and filed PDF of the named revision. Whether a later
 * revision replaced it is request_document_delivery's question: a press
 * repeated after a lost answer replays from the record first, and only a new
 * send of a replaced revision is refused (offer_revision_superseded).
 */
async function namedRevision(
  offer: z.output<typeof offerRevisionRefSchema>,
): Promise<ActionResult<{ context: ActionContext; revisionId: string; documentId: string }>> {
  const caller = await resolveManagerContext();
  if (!caller.success) return caller;
  const revision = await readDeliveryRevision(caller.context, offer);
  if (!revision) return { success: false, error: 'offer_revision_not_found' };
  return {
    success: true,
    context: caller.context,
    revisionId: revision.id,
    documentId: revision.document_id,
  };
}

/** Sends the revision's filed PDF to one recipient, once per filled form. */
export async function sendOfferRevisionEmail(
  rawInput: z.input<typeof sendOfferRevisionEmailSchema>,
): Promise<DeliveryOutcome> {
  const parsed = sendOfferRevisionEmailSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const target = await namedRevision(input);
    if (!target.success) return target;
    return await sendDocument(target.context, {
      attemptKey: input.attemptKey,
      subject: { kind: 'offer_revision', id: target.revisionId },
      documentId: target.documentId,
      recipient: input.recipient,
      emailSubject: input.subject,
      text: input.text,
    });
  } catch (error) {
    logError('sendOfferRevisionEmail: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** „Erneut senden“: a failed delivery of a revision once more, with what it carried. */
export async function retryOfferRevisionDelivery(
  rawInput: z.input<typeof retryOfferRevisionDeliverySchema>,
): Promise<RetryOutcome> {
  const parsed = retryOfferRevisionDeliverySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const caller = await resolveManagerContext();
    if (!caller.success) return caller;
    return await retryDocumentDelivery(caller.context, {
      id: parsed.data.deliveryId,
      expectedAttempt: parsed.data.expectedAttempt,
      subjectKind: 'offer_revision',
    });
  } catch (error) {
    logError('retryOfferRevisionDelivery: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
