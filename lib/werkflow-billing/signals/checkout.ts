import { recordSubscription } from '@/lib/subscription/record';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A completed Stripe Checkout (werk-flow/werkflow-planning#248). Contract
// (family.ts): the handler re-reads the session and the subscription it
// started from Stripe by id, records the subscription for the organization
// its customer names, is idempotent, and throws on failure so Stripe delivers
// again. A Checkout of another mode starts no subscription and changes nothing.
export const checkoutSignals: SignalFamily = {
  eventTypes: ['checkout.session.completed'],
  handle: async (event, stripe) => {
    if (event.type !== 'checkout.session.completed') return;
    const { subscriptionId } = await stripe.subscriptions.readCheckout(event.data.object.id);
    if (!subscriptionId) return;
    await recordSubscription(
      await stripe.subscriptions.readSubscription(subscriptionId),
      stripe.subscriptions,
    );
  },
};
