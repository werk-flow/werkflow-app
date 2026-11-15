import 'server-only';

import { getSiteUrl } from '@/lib/env/server';
import { logError } from '@/lib/logging';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readOrganizationSubscription } from '@/lib/subscription/helpers';
import { recordSubscription } from '@/lib/subscription/record';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';

// Opens Stripe Checkout for an organization's monthly subscription
// (werk-flow/werkflow-planning#248). The organization exists (its Admin
// subscribes it) or is reserved (its id is drawn before it exists, and the
// payer creates it after the Checkout). The Stripe customer is created once
// per organization with the id in its metadata, and kept in
// werkflow_subscriptions before the Checkout opens, so every signal finds it.
// The price id is server configuration (docs/technical/environments.md).

export type CheckoutFailureCode =
  | 'too_many_attempts'
  | 'checkout_unavailable'
  | 'checkout_failed'
  | 'already_subscribed';

type CheckoutRequest = {
  organizationId: string;
  userId: string;
  email: string | null;
  /** The organization's name for the customer; null before it exists. */
  name: string | null;
  /** True for an existing organization, false for a reservation. */
  linked: boolean;
};

type CheckoutOutcome = { ok: true; url: string } | { ok: false; code: CheckoutFailureCode };

const PRICE_ID = /^price_[A-Za-z0-9_]{1,250}$/;

function checkoutConfiguration() {
  const priceId = process.env.STRIPE_MONTHLY_PRICE_ID?.trim();
  const siteUrl = getSiteUrl();
  const stripe = resolveStripeGateway();
  if (!stripe.ok) {
    logError('openCheckout: Stripe configuration refused', stripe.code);
    return null;
  }
  if (!priceId || !PRICE_ID.test(priceId) || !siteUrl) {
    logError('openCheckout: configuration missing', 'checkout_configuration_missing');
    return null;
  }
  return { priceId, siteUrl, subscriptions: stripe.gateway.subscriptions };
}

export async function openCheckout(request: CheckoutRequest): Promise<CheckoutOutcome> {
  // Opening a Checkout activates billing: limited per user (lib/security/rate-limit.ts).
  const verdict = await consumeRateLimit({
    action: 'subscription_activation_per_user',
    subject: request.userId,
  });
  if (verdict === 'limited') return { ok: false, code: 'too_many_attempts' };
  if (verdict === 'unavailable') return { ok: false, code: 'checkout_failed' };

  const configuration = checkoutConfiguration();
  if (!configuration) return { ok: false, code: 'checkout_unavailable' };
  const { priceId, siteUrl, subscriptions } = configuration;

  try {
    let stored = await readOrganizationSubscription(request.organizationId);
    if (stored && !stored.holdsSubscription) {
      // A Checkout that completed before its signal arrived must not start a second subscription.
      const newest = await subscriptions.readNewestSubscription(stored.stripeCustomerId);
      if (newest) {
        await recordSubscription(newest);
        stored = await readOrganizationSubscription(request.organizationId);
      }
    }
    if (stored?.holdsSubscription) return { ok: false, code: 'already_subscribed' };

    const customerId =
      stored?.stripeCustomerId ??
      (await subscriptions.createCustomer({
        organizationId: request.organizationId,
        email: request.email,
        name: request.name,
      }));
    const { data: heldCustomerId, error } = await createSupabaseAdminClient().rpc(
      'reserve_werkflow_subscription',
      {
        p_organization_id: request.organizationId,
        p_user_id: request.userId,
        p_linked: request.linked,
        p_stripe_customer_id: customerId,
      },
    );
    if (error || !heldCustomerId) {
      logError('openCheckout: reserve_werkflow_subscription failed', error ?? 'reservation_refused');
      return { ok: false, code: 'checkout_failed' };
    }

    const url = await subscriptions.createCheckoutSession({
      customerId: heldCustomerId,
      organizationId: request.organizationId,
      priceId,
      successUrl: new URL(request.linked ? '/dashboard' : '/upgrade/bestaetigt', siteUrl).toString(),
      cancelUrl: new URL('/upgrade', siteUrl).toString(),
    });
    return { ok: true, url };
  } catch (failure) {
    logError('openCheckout: Checkout failed', failure);
    return { ok: false, code: 'checkout_failed' };
  }
}
