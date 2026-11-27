import 'server-only';

import { createHash } from 'node:crypto';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { readCompanyProfile } from '@/lib/company-profile/reads';
import { getCachedMemberships } from '@/lib/data/cached';
import { loggedRead } from '@/lib/data/read-request-cache';
import { sendEmail } from '@/lib/delivery/send-email';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { readStorageObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { deliveryHtml, senderHeader } from './mail-content';
import { DELIVERY_STATES, type DeliveryState, type DeliverySubject } from './delivery-types';

// Sends a filed document by email once, or records that the office sent it
// itself (supabase/migrations/20270310100000_record_document_deliveries.sql).
// The caller resolved an Admin or Büro context and the subject's filed
// document. The order of work: the rate limit; the delivery is recorded as
// sending with its content and the attachment's hash; the attachment is read
// and checked against that hash; the transport sends under the delivery id as
// idempotency key; the answer settles the attempt. A repeated request sends
// nothing, and a retry sends the stored content under the same key, so the
// provider delivers it once (Resend keeps a key 24 hours). Logs carry fixed
// labels and codes only: no address, subject, text or provider answer.

/**
 * How long after its request a claimed attempt may still reach the provider:
 * retry_document_delivery claims none after 23 hours, the provider keeps the
 * key 24 hours, and the half hour between leaves room for a slow read and the
 * two clocks. Later, an earlier accepted attempt could go out a second time.
 */
const SEND_DEADLINE_MS = (23 * 60 + 30) * 60_000;

export type DeliveryCaller = Pick<ActionContext, 'userId' | 'orgId' | 'isManagerOrAbove'>;

export type DeliveryOutcome = ActionResult<{ state: DeliveryState; failureCode: string | null }>;
/**
 * A retry's outcome, and whether the delivery's record holds an attempt without
 * the provider's answer: the office's row may predate one from another session.
 */
export type RetryOutcome = ActionResult<{
  state: DeliveryState;
  failureCode: string | null;
  outcomeUnknown: boolean;
}>;

const RATE_LIMITED = { success: false, error: 'rate_limited' } as const;
const SEND_UNAVAILABLE = { success: false, error: 'send_unavailable' } as const;

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'invoice_not_found',
    'invoice_not_issued',
    'service_report_not_found',
    'service_report_stale',
    'offer_revision_not_found',
    'offer_revision_superseded',
    'document_not_found',
    'delivery_not_found',
    'delivery_not_retryable',
    'delivery_retry_expired',
  ]),
);

const payloadSchema = z.object({
  deliveryId: uuidSchema,
  claimed: z.boolean(),
  state: z.enum(DELIVERY_STATES),
  failureCode: z.string().nullable(),
  attempt: z.number().int().positive(),
  requestedAt: z.iso.datetime({ offset: true }),
  recipient: z.string(),
  subject: z.string(),
  text: z.string(),
  senderName: z.string(),
  fromHeader: z.string(),
  replyTo: z.string().nullable(),
  storagePath: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
type DeliveryPayload = z.output<typeof payloadSchema>;

/** The sender: the company profile's name, else the organization's, and its email as Reply-To. */
export async function readDeliverySender(
  caller: DeliveryCaller,
): Promise<{ name: string; replyTo: string | null } | null> {
  const [stored, memberships] = await Promise.all([
    readCompanyProfile(createSupabaseAdminClient(), caller),
    getCachedMemberships(caller.userId),
  ]);
  const organizationName = memberships.find((membership) => membership.orgId === caller.orgId)?.name ?? '';
  if (!stored.success) return null;
  const { companyName, email } = stored.profile.details;
  const name = (companyName || organizationName).trim();
  const replyTo = z.email().safeParse(email.trim());
  return name ? { name, replyTo: replyTo.success ? replyTo.data : null } : null;
}

/** A send counts against the organization's budget and, when it names one, the recipient's. */
async function passRateLimit(
  caller: DeliveryCaller,
  recipient: string | null,
): Promise<ActionFailure | null> {
  const verdict = await consumeRateLimit(
    { action: 'document_send_per_organization', subject: caller.orgId },
    ...(recipient === null
      ? []
      : [{ action: 'document_send_per_recipient', subject: recipient.toLowerCase() } as const]),
  );
  if (verdict === 'limited') return RATE_LIMITED;
  if (verdict === 'unavailable') return SEND_UNAVAILABLE;
  return null;
}

/** The stored attachment, only when its bytes are the ones the delivery recorded. */
async function attachmentOf(
  caller: DeliveryCaller,
  payload: DeliveryPayload,
): Promise<Uint8Array | 'attachment_unavailable' | 'attachment_changed'> {
  try {
    const bytes = await readStorageObject({ organizationId: caller.orgId, path: payload.storagePath });
    const hash = createHash('sha256').update(bytes).digest('hex');
    return hash === payload.contentHash ? bytes : 'attachment_changed';
  } catch (error) {
    logError('sendDocument: attachment read failed', error);
    return 'attachment_unavailable';
  }
}

/** Sends one claimed attempt and settles it with the transport's answer. */
async function transmit(caller: DeliveryCaller, payload: DeliveryPayload): Promise<DeliveryOutcome> {
  const attachment = await attachmentOf(caller, payload);
  const late = Date.now() >= Date.parse(payload.requestedAt) + SEND_DEADLINE_MS;
  const result = late
    ? ({ status: 'permanent', code: 'delivery_window_passed' } as const)
    : typeof attachment === 'string'
      ? ({ status: 'permanent', code: attachment } as const)
      : await sendEmail({
          to: payload.recipient,
          subject: payload.subject,
          html: deliveryHtml(payload.text),
          text: payload.text,
          idempotencyKey: `document-delivery/${payload.deliveryId}`,
          from: payload.fromHeader,
          ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
          attachments: [
            { filename: payload.fileName, content: attachment, contentType: payload.contentType },
          ],
        });
  const outcome =
    result.status === 'accepted'
      ? { p_outcome: 'sent', p_provider_message_id: result.messageId }
      : { p_outcome: 'failed', p_failure_code: result.code };
  const { data: settled, error } = await createSupabaseAdminClient().rpc('settle_document_delivery', {
    p_organization_id: caller.orgId,
    p_delivery_id: payload.deliveryId,
    p_attempt: payload.attempt,
    ...outcome,
  });
  // Unsettled, the delivery reads as sending; after ten minutes it can be
  // retried under the same key, which the provider delivers once within a day.
  // A refused settlement (another attempt took over) answers the same: the
  // page reads the recorded state.
  if (error || settled !== true) {
    if (error) logError('sendDocument: settle_document_delivery failed', error);
    return { success: true, state: 'sending', failureCode: null };
  }
  return result.status === 'accepted'
    ? { success: true, state: 'sent', failureCode: null }
    : { success: true, state: 'failed', failureCode: result.code };
}

/** A claimed payload is sent now; an unclaimed one was sent or is being sent by an earlier press. */
async function sendClaimed(
  caller: DeliveryCaller,
  answer: { data: unknown; error: { message: string; code?: string } | null },
  logLabel: string,
): Promise<DeliveryOutcome> {
  if (answer.error) return refusal(answer.error, 'send_failed', logLabel);
  const payload = payloadSchema.safeParse(answer.data);
  if (!payload.success) return refusal(null, 'send_failed', logLabel);
  if (!payload.data.claimed) {
    return { success: true, state: payload.data.state, failureCode: payload.data.failureCode };
  }
  return transmit(caller, payload.data);
}

type DeliveryRequest = {
  attemptKey: string;
  subject: DeliverySubject;
  documentId: string;
  recipient: string;
  emailSubject: string;
  text: string;
};

/**
 * The recorded result of an earlier press under the same attempt key and
 * with the same mail, so a repeated press the limit refuses still answers
 * what happened; null when the caller made no such press or the mail differs
 * (request_document_delivery refuses that replay too); a failed read is the
 * send's own failure.
 */
async function recordedOutcome(
  caller: DeliveryCaller,
  request: DeliveryRequest,
): Promise<DeliveryOutcome | null> {
  const { data, error } = await loggedRead(
    'sendDocument: earlier delivery read failed',
    createSupabaseAdminClient()
      .from('document_deliveries')
      .select(
        'state, failure_code, channel, subject_kind, invoice_id, service_report_id, offer_revision_id, document_id, recipient_email, email_subject, message_text',
      )
      .eq('organization_id', caller.orgId)
      .eq('attempt_key', request.attemptKey)
      .eq('created_by', caller.userId)
      .maybeSingle(),
  );
  if (error) return SEND_UNAVAILABLE;
  const sameMail =
    data?.channel === 'email' &&
    data.subject_kind === request.subject.kind &&
    (data.invoice_id ?? data.service_report_id ?? data.offer_revision_id) === request.subject.id &&
    data.document_id === request.documentId &&
    data.recipient_email === request.recipient &&
    data.email_subject === request.emailSubject &&
    data.message_text === request.text;
  const state = z.enum(DELIVERY_STATES).safeParse(data?.state);
  return sameMail && state.success
    ? { success: true, state: state.data, failureCode: data.failure_code }
    : null;
}

/**
 * Sends the subject's filed document to one recipient by email, once per
 * attempt key. The answer says whether it went out or failed with a code.
 */
export async function sendDocument(
  caller: DeliveryCaller,
  request: DeliveryRequest,
): Promise<DeliveryOutcome> {
  const limited = await passRateLimit(caller, request.recipient);
  if (limited) return (await recordedOutcome(caller, request)) ?? limited;
  // A press repeated after its answer was lost answers from the record, also
  // when the sender can no longer be read; only a new mail needs it.
  const sender = await readDeliverySender(caller);
  if (!sender) return (await recordedOutcome(caller, request)) ?? { success: false, error: 'load_failed' };
  const fromHeader = senderHeader(sender.name, process.env);
  if (!fromHeader) {
    logError('sendDocument: no sending address', 'email_not_configured');
    return (await recordedOutcome(caller, request)) ?? SEND_UNAVAILABLE;
  }
  const answer = await createSupabaseAdminClient().rpc(
    'request_document_delivery',
    rpcArgs('request_document_delivery', {
      p_actor_id: caller.userId,
      p_organization_id: caller.orgId,
      p_attempt_key: request.attemptKey,
      p_subject_kind: request.subject.kind,
      p_subject_id: request.subject.id,
      p_document_id: request.documentId,
      p_recipient_email: request.recipient,
      p_email_subject: request.emailSubject,
      p_message_text: request.text,
      p_sender_name: sender.name,
      p_from_header: fromHeader,
      p_reply_to: sender.replyTo,
    }),
  );
  return sendClaimed(caller, answer, 'sendDocument: request_document_delivery failed');
}

/**
 * Sends a failed email delivery of the caller's subject kind again with its
 * stored content, once per attempt the office saw; a sent one is never sent
 * twice. A delivery of another kind reads as none. It counts against its
 * stored recipient's limit too.
 */
export async function retryDocumentDelivery(
  caller: DeliveryCaller,
  delivery: { id: string; expectedAttempt: number; subjectKind: DeliverySubject['kind'] },
): Promise<RetryOutcome> {
  const stored = await createSupabaseAdminClient()
    .from('document_deliveries')
    .select('recipient_email, subject_kind, state, outcome_unknown_at')
    .eq('organization_id', caller.orgId)
    .eq('id', delivery.id)
    .maybeSingle();
  if (stored.error)
    return refusal(stored.error, 'send_failed', 'retryDocumentDelivery: delivery read failed');
  if (stored.data && stored.data.subject_kind !== delivery.subjectKind)
    return { success: false, error: 'delivery_not_found' };
  const limited = await passRateLimit(caller, stored.data?.recipient_email ?? null);
  if (limited) return limited;
  const answer = await createSupabaseAdminClient().rpc('retry_document_delivery', {
    p_actor_id: caller.userId,
    p_organization_id: caller.orgId,
    p_delivery_id: delivery.id,
    p_expected_attempt: delivery.expectedAttempt,
  });
  const outcome = await sendClaimed(caller, answer, 'retryDocumentDelivery: retry_document_delivery failed');
  if (!outcome.success) return outcome;
  // Taking over a sending attempt marks the outcome unknown (retry_document_delivery).
  const outcomeUnknown = stored.data?.outcome_unknown_at != null || stored.data?.state === 'sending';
  return { ...outcome, outcomeUnknown };
}

/** Records that the office sent the subject's document itself, by post or by hand, once per attempt key. */
export async function recordManualDelivery(
  caller: DeliveryCaller,
  request: { attemptKey: string; subject: DeliverySubject; documentId: string; note: string },
): Promise<ActionResult> {
  const { error } = await createSupabaseAdminClient().rpc('record_manual_delivery', {
    p_actor_id: caller.userId,
    p_organization_id: caller.orgId,
    p_attempt_key: request.attemptKey,
    p_subject_kind: request.subject.kind,
    p_subject_id: request.subject.id,
    p_document_id: request.documentId,
    p_note: request.note,
  });
  if (error) return refusal(error, 'record_failed', 'recordManualDelivery: record_manual_delivery failed');
  return { success: true };
}
