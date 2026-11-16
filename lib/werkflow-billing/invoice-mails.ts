import 'server-only';

import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { readWerkflowBillingObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import type { CustomerMailKind } from '@/lib/werkflow-billing/mail-ledger';
import {
  deliverCustomerBillingMail,
  describeCustomerMail,
  raiseBillingAlarm,
} from '@/lib/werkflow-billing/mail-delivery';
import {
  renderDebitNoticeMail,
  renderInvoiceMail,
  renderReceiptMail,
  type SepaDebit,
} from '@/lib/werkflow-billing/mails/invoice';
import { readWerkflowSeller } from '@/lib/werkflow-billing/seller';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

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

/**
 * The debit notice's ledger key: one per subscription, renewal and amount, so
 * an invoice finds only a notice that announced its own amount, and a changed
 * amount gets its own notice with its invoice (LQ-60).
 */
const renewalKey = (subscriptionId: string, renewsAt: number, amountCents: number) =>
  `${subscriptionId}_${renewsAt}_${amountCents}`;

/** The debit date a debit notice announces: the renewal's Berlin day. */
const announcedDebitDate = (renewsAt: number) => formatBerlinLocalDate(new Date(renewsAt * 1000));

/** When the mail of `kind` for the Stripe object went out; null while it has not. */
async function sentAt(kind: CustomerMailKind, stripeObjectId: string): Promise<string | null> {
  // tenant-scope: cross-organization-by-design — the Stripe object id names one mail; no caller names an organization.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_billing_mails')
    .select('sent_at')
    .eq('kind', kind)
    .eq('stripe_object_id', stripeObjectId)
    .maybeSingle();
  if (error) {
    logError('invoiceMails: werkflow_billing_mails read failed', error);
    throw billingFailure('billing_mail_read_failed');
  }
  return data?.sent_at ?? null;
}

async function lateNoticeAlarm(stripeObjectId: string, debitDate: string | null, notice: string) {
  await raiseBillingAlarm({
    kind: 'debit_notice_late',
    stripeObjectId,
    facts: [
      ['Abbuchung laut Stripe', debitDate ?? 'kein Datum'],
      ['Ankündigung', notice],
    ],
  });
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
  const key = renewalKey(subscriptionId, upcoming.renewsAt, upcoming.amountCents);
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
  if (!noticeLeavesLeadTime(now, debit.debitDate)) {
    await lateNoticeAlarm(key, debit.debitDate, 'Lastschriftankündigung');
  }
  const outcome = await deliverCustomerBillingMail({
    kind: 'debit_notice',
    customer: await stripe.readCustomer(upcoming.customerId),
    stripeObjectId: key,
    mail: renderDebitNoticeMail({ amountCents: upcoming.amountCents, debit, contact }),
  });
  if (outcome.status === 'not_sent') {
    await lateNoticeAlarm(key, debit.debitDate, describeCustomerMail(outcome));
  }
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
}

async function issuedInvoice(stripeInvoiceId: string) {
  // tenant-scope: cross-organization-by-design — the Stripe invoice id is unique across organizations; the mail goes to the customer Stripe names.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_invoices')
    .select('number, issue_date, gross_cents, due_cents, file_key, stripe_customer_id')
    .eq('stripe_invoice_id', stripeInvoiceId)
    .maybeSingle();
  if (error || !data) {
    if (error) logError('invoiceMails: werkflow_invoices read failed', error);
    throw billingFailure(error ? 'werkflow_invoice_record_failed' : 'werkflow_invoice_not_issued');
  }
  return data;
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
  // for its own amount and for a debit no earlier than the day it announced.
  if (sepa) {
    const sentNotice = debit.subscriptionId
      ? await sentAt('debit_notice', renewalKey(debit.subscriptionId, debit.renewsAt, invoice.gross_cents))
      : null;
    const notice =
      sentNotice && debitDate && debitDate >= announcedDebitDate(debit.renewsAt) ? sentNotice : null;
    if (!noticeLeavesLeadTime(notice ? new Date(notice) : now, debitDate)) {
      await lateNoticeAlarm(stripeInvoiceId, debitDate, notice ? 'Lastschriftankündigung' : 'Rechnungsmail');
    }
  }
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
      dueCents: paid ? 0 : invoice.due_cents,
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
  if (outcome.status === 'not_sent') {
    await raiseBillingAlarm({
      kind: 'invoice_undelivered',
      stripeObjectId: stripeInvoiceId,
      facts: [['Rechnungsmail', describeCustomerMail(outcome)]],
    });
  }
  if (outcome.status === 'retryable' || outcome.status === 'permanent') throw billingFailure(outcome.code);
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
