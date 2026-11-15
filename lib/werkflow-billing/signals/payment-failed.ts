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
//   payment method) and one `debit_failed` alarm. Access stays (epic decision 8).
// - `charge.dispute.created`: a returned direct debit or a card chargeback
//   raises the `debit_reversed` alarm; the customer gets no mail.

async function handleFailedInvoice(invoiceId: string, stripe: StripeGateway): Promise<void> {
  const invoice = await stripe.readInvoice(invoiceId);
  const customer = invoice.customerId ? await stripe.readCustomer(invoice.customerId) : null;
  const card = invoice.paymentMethodType === 'card';
  const content = {
    customerName: customer?.name ?? null,
    invoiceNumber: invoice.number,
    amountDueCents: invoice.amountDueCents,
    payUrl: invoice.payUrl,
  };
  const mail = await deliverCustomerBillingMail({
    kind: card ? 'card_problem' : 'payment_failed',
    customer,
    stripeObjectId: invoice.id,
    mail: card ? renderCardProblemMail(content) : renderDebitFailedMail(content),
  });
  await raiseBillingAlarm({
    kind: 'debit_failed',
    stripeObjectId: invoice.id,
    facts: [
      ['Organisation', customer?.organizationId ?? 'unbekannt'],
      ['Stripe-Kunde', invoice.customerId ?? 'unbekannt'],
      ['Rechnung', invoice.number ?? 'ohne Nummer'],
      ['Offener Betrag', formatEuro(invoice.amountDueCents)],
      ['Zahlungsart', invoice.paymentMethodType ?? 'unbekannt'],
      ['Kundenmail', describeCustomerMail(mail)],
    ],
  });
  if (mail.status === 'retryable') throw billingFailure(mail.code);
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
