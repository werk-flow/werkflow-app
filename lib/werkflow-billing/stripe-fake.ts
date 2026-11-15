import Stripe from 'stripe';

import { signalVerifier, type StripeGateway } from '@/lib/werkflow-billing/stripe';

/**
 * The gateway for tests: it verifies a signal with Stripe's own check against
 * a secret the test generated, and never reaches the network. A child that
 * adds a call to StripeGateway adds its fake answer here.
 */
export function createFakeStripeGateway(webhookSecret: string): StripeGateway {
  return { verifySignal: signalVerifier(Stripe.webhooks, webhookSecret) };
}
