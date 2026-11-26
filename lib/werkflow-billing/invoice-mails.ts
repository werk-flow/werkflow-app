import 'server-only';

import { createHash } from 'node:crypto';

import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { readWerkflowBillingObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import type { CustomerMailKind } from '@/lib/werkflow-billing/mail-ledger';
import {
  deliverCustomerBillingMail,
  describeCustomerMail,
  raiseBillingAlarm,
  recordBillingAlarm,
} from '@/lib/werkflow-billing/mail-delivery';
import {
  renderDebitNoticeMail,
  renderInvoiceMail,
  renderReceiptMail,
  type SepaDebit,
} from '@/lib/werkflow-billing/mails/invoice';
import { readWerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// The debit notice, the invoice mail and the receipt (werk-flow/werkflow-planning#492).
// Each goes once per Stripe object through the mail ledger, and a refused send
// throws so the signal, or the daily comparison, sends it again.
//
// Pre-notification (register LQ-60): every SEPA debit is announced at least 2
// calendar days ahead, the period of Stripe's mandate text. A renewal gets the
// debit notice on `invoice.upcoming`; the first debit, or a renewal whose
// notice never went out, has the invoice mail as its notice. Stripe submits the
// debit itself, so a notice that leaves less, or a debit date Stripe does not
// name, raises `debit_notice_late` for a person to act on.

const NOTICE_LEAD_DAYS = 2;

/** True when a notice sent at `sentAt` reaches the customer at least 2 calendar days (Berlin) before `debitDate`. */
function noticeLeavesLeadTime(sentAt: Date, debitDate: string | null): boolean {
  return debitDate !== null && addLocalDays(formatBerlinLocalDate(sentAt), NOTICE_LEAD_DAYS) <= debitDate;
}

type SepaPayment = Pick<SepaDebit, 'mandateReference' | 'ibanLastFour'>;

/**
 * The debit notice's ledger key: one per subscription, renewal, amount and
 * payment (mandate reference and account ending), so an invoice finds only a
 * notice that announced its own amount from its own account, and a changed
 * amount or mandate gets its own notice (LQ-60). The payment is hashed: the key
 * names the row in alarms and logs, which carry no personal data.
 */
function debitNoticeKey(
  subscriptionId: string,
  renewsAt: number,
  amountCents: number,
  payment: SepaPayment,
): string {
  const identity = createHash('sha256')
    .update(JSON.stringify([payment.mandateReference, payment.ibanLastFour]))
    .digest('hex')
    .slice(0, 16);
  return `${subscriptionId}_${renewsAt}_${amountCents}_${identity}`;
}

/** The debit date a debit notice announces: the renewal's Berlin day. */
const announcedDebitDate = (renewsAt: number) => formatBerlinLocalDate(new Date(renewsAt * 1000));

const sentMailSchema = z.object({
  sent_at: z.iso.datetime({ offset: true }).nullable(),
}) satisfies z.ZodType<Pick<Tables<'werkflow_billing_mails'>, 'sent_at'>>;

/** When the mail of `kind` for the Stripe object went out; null while it has not. */
async function sentAt(kind: CustomerMailKind, stripeObjectId: string): Promise<string | null> {
  // tenant-scope: cross-organization-by-design — the Stripe object id names one mail; no caller names an organization.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_billing_mails')
    .select('sent_at')
    .eq('kind', kind)
    .eq('stripe_object_id', stripeObjectId)
    .maybeSingle();
  const row = sentMailSchema.nullable().safeParse(data);
  if (error || !row.success) {
    logError('invoiceMails: werkflow_billing_mails read failed', error ?? row.error);
    throw billingFailure('billing_mail_read_failed');
  }
  return row.data?.sent_at ?? null;
}

/**
 * Sends an alarm after the customer mail beside it and answers its failure
 * instead of throwing it; the caller throws it after the customer outcome.
 *
 * The order, wherever a customer mail and an alarm go out together:
 * 1. decide whether the alarm is due;
 * 2. record the alarm's row (`recordBillingAlarm`) and claim the customer
 *    mail's; either failing throws before anything is sent, and Stripe
 *    delivers again;
 * 3. send the customer mail, so a last free-tier slot is the customer's;
 * 4. send the alarm. One refused, without its address or never reached stays
 *    `failed`, and the daily comparison sends it.
 */
async function alarmBeside(alarm: Parameters<typeof raiseBillingAlarm>[0]): Promise<Error | null> {
  return raiseBillingAlarm(alarm).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error : billingFailure('billing_alarm_failed')),
  );
}

function lateNoticeAlarm(stripeObjectId: string, debitDate: string | null, notice: string) {
  return alarmBeside({
    kind: 'debit_notice_late',
    stripeObjectId,
    facts: [
      ['Abbuchung laut Stripe', debitDate ?? 'kein Datum'],
      ['Ankündigung', notice],
    ],
  });
}

/** Throws the customer mail's failure first, then an alarm's, so Stripe delivers the signal again. */
function throwFailure(
  outcome: Awaited<ReturnType<typeof deliverCustomerBillingMail>>,
  alarmFailures: (Error | null)[],
) {
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
  const alarmFailure = alarmFailures.find((failure) => failure !== null);
  if (alarmFailure) throw alarmFailure;
}

function sellerContact() {
  const { seller, creditorId } = readWerkflowSeller();
  return { creditorId, contact: seller.email ?? '' };
}

/**
 * The debit notice of a subscription's next SEPA renewal, on `invoice.upcoming`.
 * A card renewal needs none. `renewsAt` sends it only for that renewal: the
 * daily comparison's resend of a notice whose renewal has passed sends nothing.
 */
export async function sendDebitNotice(
  subscriptionId: string,
  stripe: StripeGateway,
  { renewsAt, now = new Date() }: { renewsAt?: number; now?: Date } = {},
): Promise<void> {
  const upcoming = await stripe.readUpcomingDebit(subscriptionId);
  if (upcoming.method?.kind !== 'sepa_debit' || upcoming.amountCents <= 0) return;
  if (renewsAt !== undefined && renewsAt !== upcoming.renewsAt) return;
  // A notice that arrives after the renewal is no notice; the invoice mail then is one.
  if (upcoming.renewsAt * 1000 <= now.getTime()) return;
  const key = debitNoticeKey(subscriptionId, upcoming.renewsAt, upcoming.amountCents, upcoming.method);
  // A replay close to the renewal finds the notice sent days before and checks nothing again.
  if (await sentAt('debit_notice', key)) return;
  const { creditorId, contact } = sellerContact();
  const debit: SepaDebit = {
    kind: 'sepa_debit',
    debitDate: announcedDebitDate(upcoming.renewsAt),
    ibanLastFour: upcoming.method.ibanLastFour,
    mandateReference: upcoming.method.mandateReference,
    creditorId,
  };
  // Checked before each send attempt: a sent notice is never checked again.
  const late = !noticeLeavesLeadTime(now, debit.debitDate);
  if (late) await recordBillingAlarm({ kind: 'debit_notice_late', stripeObjectId: key });
  const outcome = await deliverCustomerBillingMail({
    kind: 'debit_notice',
    customer: await stripe.readCustomer(upcoming.customerId),
    stripeObjectId: key,
    mail: renderDebitNoticeMail({ amountCents: upcoming.amountCents, debit, contact }),
  });
  // A notice that did not go is no notice either; it then names why.
  const alarm =
    late || outcome.status === 'not_sent'
      ? await lateNoticeAlarm(
          key,
          debit.debitDate,
          outcome.status === 'not_sent' ? describeCustomerMail(outcome) : 'Lastschriftankündigung',
        )
      : null;
  throwFailure(outcome, [alarm]);
}

/**
 * Sends a failed debit notice again from its ledger key, only for the renewal
 * the key names. Answers `passed`, without asking Stripe, once that renewal
 * has come: the notice is then never due again.
 */
export async function resendDebitNotice(
  key: string,
  stripe: StripeGateway,
  now: Date,
): Promise<'resent' | 'passed'> {
  const named = /^(\w+)_(\d+)_\d+_[0-9a-f]{16}$/.exec(key);
  if (!named?.[1] || !named[2]) throw billingFailure('debit_notice_key_invalid');
  const renewsAt = Number(named[2]);
  if (renewsAt * 1000 <= now.getTime()) return 'passed';
  await sendDebitNotice(named[1], stripe, { renewsAt, now });
  return 'resent';
}

const issuedInvoiceSchema = z.object({
  number: z.string().min(1),
  issue_date: z.iso.date(),
  gross_cents: z.number().int().nonnegative(),
  due_cents: z.number().int().nonnegative(),
  file_key: z.string().min(1),
  stripe_customer_id: z.string().min(1),
}) satisfies z.ZodType<
  Pick<
    Tables<'werkflow_invoices'>,
    'number' | 'issue_date' | 'gross_cents' | 'due_cents' | 'file_key' | 'stripe_customer_id'
  >
>;

async function issuedInvoice(stripeInvoiceId: string): Promise<z.infer<typeof issuedInvoiceSchema>> {
  // tenant-scope: cross-organization-by-design — the Stripe invoice id is unique across organizations; the mail goes to the customer Stripe names.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_invoices')
    .select('number, issue_date, gross_cents, due_cents, file_key, stripe_customer_id')
    .eq('stripe_invoice_id', stripeInvoiceId)
    .is('stripe_credit_note_id', null)
    .maybeSingle();
  const row = issuedInvoiceSchema.nullable().safeParse(data);
  if (error || !row.success) {
    logError('invoiceMails: werkflow_invoices read failed', error ?? row.error);
    throw billingFailure('werkflow_invoice_record_failed');
  }
  if (!row.data) throw billingFailure('werkflow_invoice_not_issued');
  return row.data;
}

/** The invoice mail with its original, once per issued invoice; called after the issue step. */
export async function sendInvoiceMail(
  stripeInvoiceId: string,
  stripe: StripeGateway,
  now = new Date(),
): Promise<void> {
  if (await sentAt('invoice', stripeInvoiceId)) return;
  const invoice = await issuedInvoice(stripeInvoiceId);
  const debit = await stripe.readInvoiceDebit(stripeInvoiceId);
  const paid = debit.status === 'paid';
  const { creditorId, contact } = sellerContact();
  const sepa = invoice.gross_cents > 0 && debit.method?.kind === 'sepa_debit' ? debit.method : null;
  const debitDate = debit.expectedDebitDate;
  // Stripe creates the charge as it submits the debit; until then its date is
  // unknown and Stripe delivers again. The daily comparison alarms a mail that stays out.
  if (sepa && !debitDate && !paid) throw billingFailure('werkflow_debit_date_pending');
  // Checked before each send attempt, so the attempt that sends was checked:
  // a sent invoice mail is never checked again. A mail first sent after the
  // debit, as by the paid backstop, is late too. A debit notice counts only
  // for its own amount and account, and for a debit no earlier than the day it announced.
  let lateNotice: string | null = null;
  if (sepa) {
    const sentNotice = debit.subscriptionId
      ? await sentAt(
          'debit_notice',
          debitNoticeKey(debit.subscriptionId, debit.renewsAt, invoice.gross_cents, sepa),
        )
      : null;
    const notice =
      sentNotice && debitDate && debitDate >= announcedDebitDate(debit.renewsAt) ? sentNotice : null;
    if (!noticeLeavesLeadTime(notice ? new Date(notice) : now, debitDate)) {
      lateNotice = notice ? 'Lastschriftankündigung' : 'Rechnungsmail';
    }
  }
  if (lateNotice) await recordBillingAlarm({ kind: 'debit_notice_late', stripeObjectId: stripeInvoiceId });
  const payment =
    sepa && debitDate
      ? { ...sepa, debitDate, creditorId }
      : debit.method?.kind === 'card'
        ? debit.method
        : null;
  const outcome = await deliverCustomerBillingMail({
    kind: 'invoice',
    customer: await stripe.readCustomer(invoice.stripe_customer_id),
    stripeObjectId: stripeInvoiceId,
    mail: renderInvoiceMail({
      invoiceNumber: invoice.number,
      issueDate: invoice.issue_date,
      grossCents: invoice.gross_cents,
      // The issued row never changes, so a retry after a lost answer renders the
      // same mail and Resend's idempotency key delivers it once.
      dueCents: invoice.due_cents,
      payment,
      contact,
    }),
    attachments: [
      {
        filename: `WerkFlow-Rechnung-${invoice.number}.pdf`,
        content: await readWerkflowBillingObject(invoice.file_key),
        contentType: 'application/pdf',
      },
    ],
  });
  const lateAlarm = lateNotice ? await lateNoticeAlarm(stripeInvoiceId, debitDate, lateNotice) : null;
  const unsentAlarm =
    outcome.status === 'not_sent'
      ? await alarmBeside({
          kind: 'invoice_undelivered',
          stripeObjectId: stripeInvoiceId,
          facts: [['Rechnungsmail', describeCustomerMail(outcome)]],
        })
      : null;
  throwFailure(outcome, [lateAlarm, unsentAlarm]);
}

/** The receipt once Stripe reports the invoice paid; an invoice with nothing paid gets none. */
export async function sendReceiptMail(stripeInvoiceId: string, stripe: StripeGateway): Promise<void> {
  if (await sentAt('receipt', stripeInvoiceId)) return;
  const debit = await stripe.readInvoiceDebit(stripeInvoiceId);
  if (debit.status !== 'paid' || debit.amountPaidCents <= 0) return;
  const invoice = await issuedInvoice(stripeInvoiceId);
  const outcome = await deliverCustomerBillingMail({
    kind: 'receipt',
    customer: await stripe.readCustomer(invoice.stripe_customer_id),
    stripeObjectId: stripeInvoiceId,
    mail: renderReceiptMail({
      invoiceNumber: invoice.number,
      amountPaidCents: debit.amountPaidCents,
      paidOn: formatBerlinLocalDate(debit.paidAt ? new Date(debit.paidAt * 1000) : new Date()),
      method: debit.method,
      contact: sellerContact().contact,
    }),
  });
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
}
