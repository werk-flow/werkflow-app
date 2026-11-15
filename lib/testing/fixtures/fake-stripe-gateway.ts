import { billingFailure } from '@/lib/werkflow-billing/failure';
import {
  resolveStripeGateway,
  type StripeBillingCustomer,
  type StripeBillingDispute,
  type StripeBillingInvoice,
  type StripeBillingMandate,
  type StripeGateway,
} from '@/lib/werkflow-billing/stripe';

/** What the fake's reads answer, by id; an id it does not hold fails as Stripe's read would. */
export type FakeStripeObjects = {
  invoices?: Record<string, StripeBillingInvoice>;
  customers?: Record<string, StripeBillingCustomer | null>;
  mandates?: Record<string, StripeBillingMandate>;
  disputes?: Record<string, StripeBillingDispute>;
};

async function lookup<T>(objects: Record<string, T> | undefined, id: string): Promise<T> {
  const found = objects?.[id];
  if (found === undefined) throw billingFailure('stripe_read_failed');
  return found;
}

/**
 * The gateway for tests: the real signal check against a secret the test
 * generated, and a synthetic test key that never reaches the network because
 * no call goes out. A child that adds a call to StripeGateway answers it here
 * with a fake, so no test reaches Stripe.
 */
export function createFakeStripeGateway(
  webhookSecret: string,
  objects: FakeStripeObjects = {},
): StripeGateway {
  const resolved = resolveStripeGateway({
    STRIPE_SECRET_KEY: 'sk_test_fake_gateway',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  if (!resolved.ok) throw new Error(`The fake Stripe gateway was refused: ${resolved.code}`);
  return {
    verifySignal: resolved.gateway.verifySignal,
    readInvoice: (id) => lookup(objects.invoices, id),
    readCustomer: (id) => lookup(objects.customers, id),
    readMandate: (id) => lookup(objects.mandates, id),
    readDispute: (id) => lookup(objects.disputes, id),
  };
}
