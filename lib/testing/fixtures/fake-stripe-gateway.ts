import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';

/**
 * The gateway for tests: the real signal check against a secret the test
 * generated, and a synthetic test key that never reaches the network because
 * no call goes out. A child that adds a call to StripeGateway answers it here
 * with a fake, so no test reaches Stripe.
 */
export function createFakeStripeGateway(webhookSecret: string): StripeGateway {
  const resolved = resolveStripeGateway({
    STRIPE_SECRET_KEY: 'sk_test_fake_gateway',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  if (!resolved.ok) throw new Error(`The fake Stripe gateway was refused: ${resolved.code}`);
  return resolved.gateway;
}
