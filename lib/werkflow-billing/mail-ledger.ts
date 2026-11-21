import 'server-only';

import { createHash } from 'node:crypto';

import { sendEmail } from '@/lib/delivery/send-email';
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

export type CustomerMailKind = 'payment_failed' | 'card_problem' | 'mandate_inactive';
type MailKind = CustomerMailKind | `alarm.${BillingAlarmKind}`;

export type BillingMailOutcome =
  | { status: 'sent' | 'already_sent' }
  | { status: 'retryable' | 'permanent'; code: string };

type Environment = Readonly<Record<string, string | undefined>>;

function contentHash(recipient: string, mail: RenderedMail, replyTo: string | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify([recipient, replyTo ?? null, mail.subject, mail.html, mail.text]))
    .digest('hex')
    .slice(0, 32);
}

/** One customer mail (with its organization) or one alarm (with none). */
export async function deliverBillingMail(
  input: {
    kind: MailKind;
    organizationId: string | null;
    recipient: string;
    stripeObjectId: string;
    mail: RenderedMail;
    replyTo?: string;
  },
  environment: Environment = process.env,
): Promise<BillingMailOutcome> {
  const { kind, organizationId, recipient, stripeObjectId, mail } = input;
  const admin = createSupabaseAdminClient();
  const { data: mailId, error: claimError } = await admin.rpc(
    'claim_werkflow_billing_mail',
    rpcArgs('claim_werkflow_billing_mail', {
      p_kind: kind,
      p_organization_id: organizationId,
      p_recipient: recipient,
      p_stripe_object_id: stripeObjectId,
    }),
  );
  if (claimError) throw billingFailure('billing_mail_claim_failed');
  if (!mailId) return { status: 'already_sent' };

  const result = await sendEmail(
    {
      to: recipient,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `werkflow-billing-mail/${mailId}/${contentHash(recipient, mail, input.replyTo)}`,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
    environment,
  );
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
