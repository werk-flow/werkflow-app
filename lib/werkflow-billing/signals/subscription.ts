import { recordSubscription } from '@/lib/subscription/record';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A Stripe subscription's state (werk-flow/werkflow-planning#248). Contract
// (family.ts): the handler re-reads the subscription from Stripe by id, so
// signals of one second in any order record Stripe's current state, and
// throws on failure so Stripe delivers again. No lockout in stage A: a past
// due subscription, or one Stripe cancelled for a failed payment, still holds
// (werkflow_subscriptions.holds_subscription), and nothing reads it for access.
export const subscriptionSignals: SignalFamily = {
  eventTypes: [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ],
  handle: async (event, stripe) => {
    if (
      event.type !== 'customer.subscription.created' &&
      event.type !== 'customer.subscription.updated' &&
      event.type !== 'customer.subscription.deleted'
    ) {
      return;
    }
    await recordSubscription(
      await stripe.subscriptions.readSubscription(event.data.object.id),
      stripe.subscriptions,
    );
  },
};
