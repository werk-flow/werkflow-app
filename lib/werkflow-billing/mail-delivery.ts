import 'server-only';

import { billingFailure } from '@/lib/werkflow-billing/failure';
import {
  deliverBillingMail,
  type BillingMailOutcome,
  type CustomerMailKind,
} from '@/lib/werkflow-billing/mail-ledger';
import {
  renderAlarmMail,
  type BillingAlarmFacts,
  type BillingAlarmKind,
} from '@/lib/werkflow-billing/mails/alarm';
import type { RenderedMail } from '@/lib/werkflow-billing/mails/layout';
import type { StripeBillingCustomer } from '@/lib/werkflow-billing/stripe';
import { uuidSchema } from '@/lib/validation/uuid';

// The two ways WerkFlow's billing code mails (werk-flow/werkflow-planning#251):
// an alarm to the person at WERKFLOW_ALARM_EMAIL, and a mail to a Stripe
// customer's billing contact that answers to WERKFLOW_BILLING_REPLY_TO
// (docs/technical/environments.md, "Credentials"). Each is sent at most once
// per kind and Stripe object through mail-ledger.ts.

type Environment = Readonly<Record<string, string | undefined>>;

// Local and CI processes send to the in-memory outbox only (lib/delivery/send-email.ts).
const LOCAL_ALARM_ADDRESS = 'alarm@werkflow.test';
const LOCAL_REPLY_TO = 'abrechnung@werkflow.test';

function configured(environment: Environment, name: string, localValue: string): string | null {
  return environment[name]?.trim() || (environment.VERCEL_ENV ? null : localValue);
}

/**
 * Raises one alarm to WerkFlow's alarm address, at most once per kind and
 * Stripe object. `facts` name ids and codes only, never personal data. Throws
 * when the alarm did not reach the transport, so the caller's signal is
 * delivered again; the error's `code` says why.
 */
export async function raiseBillingAlarm(
  alarm: { kind: BillingAlarmKind; stripeObjectId: string; facts?: BillingAlarmFacts },
  environment: Environment = process.env,
): Promise<void> {
  const recipient = configured(environment, 'WERKFLOW_ALARM_EMAIL', LOCAL_ALARM_ADDRESS);
  if (!recipient) throw billingFailure('billing_alarm_address_missing');
  const outcome = await deliverBillingMail(
    {
      kind: `alarm.${alarm.kind}`,
      organizationId: null,
      recipient,
      stripeObjectId: alarm.stripeObjectId,
      mail: renderAlarmMail(alarm.kind, [['Stripe-Objekt', alarm.stripeObjectId], ...(alarm.facts ?? [])]),
    },
    environment,
  );
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
}

type CustomerMailOutcome = BillingMailOutcome | { status: 'not_sent'; code: string };

/**
 * Sends one billing mail to a Stripe customer's billing contact, for the
 * organization in its `werkflow_organization_id` metadata. A permanent refusal
 * raises the `mail_failed` alarm. A retryable or permanent outcome is the
 * caller's to throw after its own alarm went out, so the row stays `failed`
 * and Stripe's next delivery sends it again.
 */
export async function deliverCustomerBillingMail(
  input: {
    kind: CustomerMailKind;
    customer: StripeBillingCustomer | null;
    stripeObjectId: string;
    mail: RenderedMail;
  },
  environment: Environment = process.env,
): Promise<CustomerMailOutcome> {
  const organizationId = uuidSchema.safeParse(input.customer?.organizationId);
  if (!organizationId.success) return { status: 'not_sent', code: 'customer_without_organization' };
  const recipient = input.customer?.email;
  if (!recipient) return { status: 'not_sent', code: 'customer_without_email' };
  const replyTo = configured(environment, 'WERKFLOW_BILLING_REPLY_TO', LOCAL_REPLY_TO);
  if (!replyTo) return { status: 'retryable', code: 'billing_reply_to_missing' };

  const outcome = await deliverBillingMail(
    {
      kind: input.kind,
      organizationId: organizationId.data,
      recipient,
      stripeObjectId: input.stripeObjectId,
      mail: input.mail,
      replyTo,
    },
    environment,
  );
  if (outcome.status === 'permanent') {
    await raiseBillingAlarm(
      {
        kind: 'mail_failed',
        stripeObjectId: input.stripeObjectId,
        facts: [
          ['Organisation', organizationId.data],
          ['Mail', input.kind],
          ['Grund', outcome.code],
        ],
      },
      environment,
    );
  }
  return outcome;
}

/**
 * The customer mail as an alarm fact. It depends only on Stripe's state, never
 * on how a send went, so an alarm sent again after a lost answer carries the
 * same content and its idempotency key delivers it once.
 */
export function describeCustomerMail(outcome: CustomerMailOutcome): string {
  return outcome.status === 'not_sent' ? `nicht gesendet (${outcome.code})` : 'an den Rechnungskontakt';
}
