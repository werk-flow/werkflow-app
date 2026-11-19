import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A Stripe subscription's state. Contract (family.ts): the input is the verified event;
// the handler re-reads its object from Stripe by id, is idempotent, and throws
// on failure so Stripe delivers again. Until werk-flow/werkflow-planning#248
// fills it, it only returns, which marks the signal handled.
export const subscriptionSignals: SignalFamily = {
  eventTypes: [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ],
  handle: async () => {},
};
