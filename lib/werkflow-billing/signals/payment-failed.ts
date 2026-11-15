import 'server-only';

import { billingFailure, signalObjectId } from '@/lib/werkflow-billing/failure';
import { formatEuro } from '@/lib/werkflow-billing/mails/layout';
import { renderCardProblemMail, renderDebitFailedMail } from '@/lib/werkflow-billing/mails/payment-failed';
import {
  deliverCustomerBillingMail,
  describeCustomerMail,
  raiseBillingAlarm,
} from '@/lib/werkflow-billing/mail-delivery';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

// A failed or reversed payment of a WerkFlow invoice (werk-flow/werkflow-planning#251).
// Contract (family.ts): the handler re-reads its object from Stripe by id, is
// idempotent, and throws on failure so Stripe delivers again.
//
// - `invoice.payment_failed`: one mail to the customer's billing contact per
//   invoice (card declined or direct debit failed, by the newest attempt's
//   payment method) and one `debit_failed` alarm, while the invoice is still
//   open with an amount remaining. Access stays (epic decision 8).
// - `charge.dispute.created`: a returned direct debit or a card chargeback
//   raises the `debit_reversed` alarm; the customer gets no mail.

// A failure signal can arrive late or again after the invoice was paid another way.
const OPEN_STATUS = 'open';

const MAIL_BY_METHOD = {
  card: { kind: 'card_problem', render: renderCardProblemMail },
  sepa_debit: { kind: 'payment_failed', render: renderDebitFailedMail },
} as const;

async function handleFailedInvoice(invoiceId: string, stripe: StripeGateway): Promise<void> {
  const invoice = await stripe.readInvoice(invoiceId);
  if (invoice.status !== OPEN_STATUS || invoice.amountRemainingCents <= 0) return;
  const customer = invoice.customerId ? await stripe.readCustomer(invoice.customerId) : null;
  const method =
    invoice.paymentMethodType === 'card' || invoice.paymentMethodType === 'sepa_debit'
      ? MAIL_BY_METHOD[invoice.paymentMethodType]
      : null;
  // An unknown method gets no guessed wording; the alarm tells the person to write.
  const mail = method
    ? await deliverCustomerBillingMail({
        kind: method.kind,
        customer,
        stripeObjectId: invoice.id,
        mail: method.render({
          customerName: customer?.name ?? null,
          invoiceNumber: invoice.number,
          amountRemainingCents: invoice.amountRemainingCents,
          payUrl: invoice.payUrl,
        }),
      })
    : ({ status: 'not_sent', code: 'payment_method_unknown' } as const);
  await raiseBillingAlarm({
    kind: 'debit_failed',
    stripeObjectId: invoice.id,
    facts: [
      ['Organisation', customer?.organizationId ?? 'unbekannt'],
      ['Stripe-Kunde', invoice.customerId ?? 'unbekannt'],
      ['Rechnung', invoice.number ?? 'ohne Nummer'],
      ['Offener Betrag', formatEuro(invoice.amountRemainingCents)],
      ['Zahlungsart', invoice.paymentMethodType ?? 'unbekannt'],
      ['Kundenmail', describeCustomerMail(mail)],
    ],
  });
  if (mail.status === 'retryable' || mail.status === 'permanent') throw billingFailure(mail.code);
}

async function handleDispute(disputeId: string, stripe: StripeGateway): Promise<void> {
  const dispute = await stripe.readDispute(disputeId);
  const customer = dispute.customerId ? await stripe.readCustomer(dispute.customerId) : null;
  await raiseBillingAlarm({
    kind: 'debit_reversed',
    stripeObjectId: dispute.id,
    facts: [
      ['Organisation', customer?.organizationId ?? 'unbekannt'],
      ['Stripe-Kunde', dispute.customerId ?? 'unbekannt'],
      ['Zahlung', dispute.chargeId],
      ['Betrag', formatEuro(dispute.amountCents)],
      ['Grund laut Stripe', dispute.reason],
    ],
  });
}

export const paymentFailedSignals: SignalFamily = {
  eventTypes: ['invoice.payment_failed', 'charge.dispute.created'],
  handle: async (event, stripe) => {
    const id = signalObjectId(event);
    if (event.type === 'charge.dispute.created') await handleDispute(id, stripe);
    else await handleFailedInvoice(id, stripe);
  },
};
