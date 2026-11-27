import 'server-only';

import { createHash } from 'node:crypto';

import { type EmailMessage, sendEmail } from '@/lib/delivery/send-email';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import type { BillingAlarmKind } from '@/lib/werkflow-billing/mails/alarm';
import type { RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// Sends one WerkFlow billing mail or alarm at most once per kind and Stripe
// object (werk-flow/werkflow-planning#251). The row in werkflow_billing_mails
// is claimed first; its id and a hash of the exact content are the transport's
// idempotency key, so a lost answer sent again with the same content delivers
// once, and content that changed between attempts (an alarm's facts, an
// amount) is a new message instead of one Resend refuses for its reused key. A sent row is never sent again. A refused
// send (quota, rate limit, outage) stays `failed` with its code and is sent on
// the next claim, which Stripe's next delivery of the signal makes.

export type CustomerMailKind =
  | 'payment_failed'
  | 'card_problem'
  | 'mandate_inactive'
  | 'debit_notice'
  | 'invoice'
  | 'receipt'
  | 'refund';
type MailKind = CustomerMailKind | `alarm.${BillingAlarmKind}`;

export type BillingMailOutcome =
  | { status: 'sent' | 'already_sent' }
  | { status: 'retryable' | 'permanent'; code: string };

type Environment = Readonly<Record<string, string | undefined>>;

type Attachments = EmailMessage['attachments'];

function contentHash(
  recipient: string,
  mail: RenderedMail,
  replyTo: string | undefined,
  attachments: Attachments,
): string {
  const hash = createHash('sha256').update(
    JSON.stringify([recipient, replyTo ?? null, mail.subject, mail.html, mail.text]),
  );
  for (const attachment of attachments ?? []) hash.update(attachment.filename).update(attachment.content);
  return hash.digest('hex').slice(0, 32);
}

/** Resend's answer while another request under the same idempotency key is still sending. */
const IN_FLIGHT = 'email_concurrent_idempotent_requests';
/** About 15 s in all; a send still in flight after them settles failed for Stripe's next delivery. */
const IN_FLIGHT_WAITS_MS = [1_000, 2_000, 4_000, 8_000];

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type MailRow = { kind: MailKind; organizationId: string | null; recipient: string; stripeObjectId: string };

/** The row's id to send under, or null when it was sent before. */
async function claim(admin: Admin, row: MailRow): Promise<string | null> {
  const { data: mailId, error } = await admin.rpc(
    'claim_werkflow_billing_mail',
    rpcArgs('claim_werkflow_billing_mail', {
      p_kind: row.kind,
      p_organization_id: row.organizationId,
      p_recipient: row.recipient,
      p_stripe_object_id: row.stripeObjectId,
    }),
  );
  if (error) throw billingFailure('billing_mail_claim_failed');
  return mailId;
}

/**
 * Records a mail that cannot go out at all, such as an alarm without its
 * address, as `failed` with `code`, so the daily comparison sends it once it can.
 */
export async function recordUnsentBillingMail(row: MailRow, code: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const mailId = await claim(admin, row);
  if (!mailId) return;
  const { error } = await admin.rpc(
    'settle_werkflow_billing_mail',
    rpcArgs('settle_werkflow_billing_mail', {
      p_mail_id: mailId,
      p_organization_id: row.organizationId,
      p_outcome: 'failed',
      p_provider_message_id: null,
      p_failure_code: code,
    }),
  );
  if (error) throw billingFailure('billing_mail_settle_failed');
}

/** Ends a failed debit notice whose renewal has passed, so the daily comparison no longer resends it. */
export async function expireDebitNotice(mailId: string, organizationId: string): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc(
    'expire_werkflow_billing_mail',
    rpcArgs('expire_werkflow_billing_mail', { p_mail_id: mailId, p_organization_id: organizationId }),
  );
  if (error) throw billingFailure('billing_mail_expire_failed');
}

/**
 * Moves a failed mail behind every failed row not yet tried, before the daily
 * comparison resends it, so a resend that fails before its claim still gives
 * the next row its turn. False when the row is no longer failed.
 */
export async function recordMailAttempt({
  mailId,
  organizationId,
}: {
  mailId: string;
  organizationId: string | null;
}): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    'record_werkflow_billing_mail_attempt',
    rpcArgs('record_werkflow_billing_mail_attempt', { p_mail_id: mailId, p_organization_id: organizationId }),
  );
  if (error) throw billingFailure('billing_mail_attempt_failed');
  return data === true;
}

/** One customer mail (with its organization) or one alarm (with none). */
export async function deliverBillingMail(
  input: MailRow & { mail: RenderedMail; replyTo?: string; attachments?: Attachments },
  environment: Environment = process.env,
): Promise<BillingMailOutcome> {
  const { organizationId, recipient, mail } = input;
  const admin = createSupabaseAdminClient();
  const mailId = await claim(admin, input);
  if (!mailId) return { status: 'already_sent' };

  const message = {
    to: recipient,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: `werkflow-billing-mail/${mailId}/${contentHash(recipient, mail, input.replyTo, input.attachments)}`,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.attachments ? { attachments: input.attachments } : {}),
  };
  let result = await sendEmail(message, environment);
  // Another claim of this row is sending the same message: once it ends, the
  // same key answers its id. Two signals of one invoice, such as the replay
  // after an organization's creation and Stripe's live payment signal, can
  // send its invoice mail at the same moment.
  for (const wait of IN_FLIGHT_WAITS_MS) {
    if (result.status !== 'retryable' || result.code !== IN_FLIGHT) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    result = await sendEmail(message, environment);
  }
  const settled =
    result.status === 'accepted'
      ? { p_outcome: 'sent', p_provider_message_id: result.messageId, p_failure_code: null }
      : { p_outcome: 'failed', p_provider_message_id: null, p_failure_code: result.code };
  const { error: settleError } = await admin.rpc(
    'settle_werkflow_billing_mail',
    rpcArgs('settle_werkflow_billing_mail', {
      p_mail_id: mailId,
      p_organization_id: organizationId,
      ...settled,
    }),
  );
  // Sent but not recorded: the next claim sends again under the same key, which
  // Resend delivers once within its 24-hour key window. A retry later than that,
  // after an accepted send whose settlement failed, can deliver a second copy:
  // an accepted residual, since it needs a database failure right after an
  // accepted send and Stripe's retries usually come within hours.
  if (settleError) throw billingFailure('billing_mail_settle_failed');
  return result.status === 'accepted' ? { status: 'sent' } : { status: result.status, code: result.code };
}
