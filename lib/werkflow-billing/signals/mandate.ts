import 'server-only';

import { billingFailure, signalObjectId } from '@/lib/werkflow-billing/failure';
import { renderMandateInactiveMail } from '@/lib/werkflow-billing/mails/mandate';
import {
  deliverCustomerBillingMail,
  describeCustomerMail,
  raiseBillingAlarm,
} from '@/lib/werkflow-billing/mail-delivery';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A changed SEPA mandate (werk-flow/werkflow-planning#251). Contract
// (family.ts): the handler re-reads the mandate from Stripe by id, is
// idempotent, and throws on failure so Stripe delivers again. A mandate that
// Stripe now reports inactive, for example revoked by the bank, sends one mail
// to the customer's billing contact and one `mandate_inactive` alarm; any
// other state changes nothing. Access stays (epic decision 8).

export const mandateSignals: SignalFamily = {
  eventTypes: ['mandate.updated'],
  handle: async (event, stripe) => {
    const mandate = await stripe.readMandate(signalObjectId(event));
    if (mandate.status !== 'inactive') return;
    const customer = mandate.customerId ? await stripe.readCustomer(mandate.customerId) : null;
    const mail = await deliverCustomerBillingMail({
      kind: 'mandate_inactive',
      customer,
      stripeObjectId: mandate.id,
      mail: renderMandateInactiveMail({
        customerName: customer?.name ?? null,
        ibanLastFour: mandate.ibanLastFour,
      }),
    });
    await raiseBillingAlarm({
      kind: 'mandate_inactive',
      stripeObjectId: mandate.id,
      facts: [
        ['Organisation', customer?.organizationId ?? 'unbekannt'],
        ['Stripe-Kunde', mandate.customerId ?? 'unbekannt'],
        ['Kundenmail', describeCustomerMail(mail)],
      ],
    });
    if (mail.status === 'retryable' || mail.status === 'permanent') throw billingFailure(mail.code);
  },
};
