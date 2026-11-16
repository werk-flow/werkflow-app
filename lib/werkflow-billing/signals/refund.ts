import 'server-only';

import { recordRefundFailure } from '@/lib/subscription/record';
import { uuidSchema } from '@/lib/validation/uuid';
import { signalObjectId } from '@/lib/werkflow-billing/failure';
import { raiseBillingAlarm } from '@/lib/werkflow-billing/mail-delivery';
import { formatEuro } from '@/lib/werkflow-billing/mails/layout';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A refund Stripe could not pay out (werk-flow/werkflow-planning#495).
// Contract (family.ts): the handler re-reads the refund from Stripe by id, is
// idempotent, and throws on failure so Stripe delivers again. A refund that
// failed raises the `refund_failed` alarm, so a person refunds by hand; one
// the duplicate backstop issued (lib/subscription/record.ts) is also recorded
// against its duplicate and payment. Any other refund state changes nothing.
export const refundSignals: SignalFamily = {
  eventTypes: ['refund.failed', 'charge.refund.updated'],
  handle: async (event, stripe) => {
    const refund = await stripe.subscriptions.readRefund(signalObjectId(event));
    if (refund.status !== 'failed') return;
    const customer = refund.customerId ? await stripe.readCustomer(refund.customerId) : null;
    const organizationId = uuidSchema.safeParse(customer?.organizationId);
    if (organizationId.success && refund.duplicateSubscriptionId && refund.paymentIntentId) {
      await recordRefundFailure({
        organizationId: organizationId.data,
        subscriptionId: refund.duplicateSubscriptionId,
        refundId: refund.id,
        paymentIntentId: refund.paymentIntentId,
      });
    }
    await raiseBillingAlarm({
      kind: 'refund_failed',
      stripeObjectId: refund.id,
      facts: [
        ['Organisation', organizationId.success ? organizationId.data : 'unbekannt'],
        ['Stripe-Kunde', refund.customerId ?? 'unbekannt'],
        ['Zahlung', refund.paymentIntentId ?? 'unbekannt'],
        ['Betrag', formatEuro(refund.amountCents)],
        ['Doppeltes Abo', refund.duplicateSubscriptionId ?? 'keins'],
      ],
    });
  },
};
