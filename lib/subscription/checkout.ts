import 'server-only';

import { getSiteUrl } from '@/lib/env/server';
import { logError } from '@/lib/logging';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readOrganizationSubscription } from '@/lib/subscription/helpers';
import { recordSubscription } from '@/lib/subscription/record';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';
import type {
  StripeCheckoutSession,
  StripeSubscriptionGateway,
} from '@/lib/werkflow-billing/stripe-subscriptions';
import { z } from '@/lib/zod';

// Opens Stripe Checkout for an organization's monthly subscription
// (werk-flow/werkflow-planning#248). The organization exists (its Admin
// subscribes it) or is reserved (its id is drawn before it exists, and the
// payer creates it after the Checkout). The Stripe customer is created once
// per organization with the id in its metadata, and kept in
// werkflow_subscriptions before the Checkout opens, so every signal finds it.
// The price id is server configuration (docs/technical/environments.md).
//
// One payable Checkout per organization, held in the database: every start
// locks the organization's row (begin_werkflow_checkout) and answers its open
// session; only a start that claims a new attempt first leaves the stored
// session unpayable, then creates one session and stores it
// (finish_werkflow_checkout). A URL reaches a payer only once it is stored,
// so a session whose answer was lost, or whose claim lapsed, is never paid.

export type CheckoutFailureCode =
  | 'too_many_attempts'
  | 'checkout_unavailable'
  | 'checkout_failed'
  | 'checkout_in_progress'
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

// begin_werkflow_checkout's answer, parsed once at the Supabase boundary.
const beginSchema = z.discriminatedUnion('result', [
  z.object({ result: z.enum(['subscribed', 'busy']) }),
  z.object({ result: z.literal('open'), session_url: z.string().startsWith('https://') }),
  z.object({
    result: z.literal('claimed'),
    stripe_customer_id: z.string(),
    attempt: z.number().int().positive(),
    session_id: z.string().nullable(),
  }),
]);
type CheckoutClaim = Extract<z.infer<typeof beginSchema>, { result: 'claimed' }>;

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
    const stored = await readOrganizationSubscription(request.organizationId);
    if (stored?.holdsSubscription) return { ok: false, code: 'already_subscribed' };

    const customerId =
      stored?.stripeCustomerId ??
      (await subscriptions.createCustomer({
        organizationId: request.organizationId,
        email: request.email,
        name: request.name,
      }));
    const { data, error } = await createSupabaseAdminClient().rpc('begin_werkflow_checkout', {
      p_organization_id: request.organizationId,
      p_user_id: request.userId,
      p_linked: request.linked,
      p_stripe_customer_id: customerId,
    });
    const begun = beginSchema.safeParse(data);
    if (error || !begun.success) {
      logError('openCheckout: begin_werkflow_checkout failed', error ?? 'invalid_result');
      return { ok: false, code: 'checkout_failed' };
    }
    switch (begun.data.result) {
      case 'subscribed':
        return { ok: false, code: 'already_subscribed' };
      case 'open':
        return { ok: true, url: begun.data.session_url };
      case 'busy':
        return { ok: false, code: 'checkout_in_progress' };
      case 'claimed':
        return await claimedCheckout(request, begun.data, {
          subscriptions,
          priceId,
          successUrl: new URL(request.linked ? '/dashboard' : '/upgrade/bestaetigt', siteUrl).toString(),
          cancelUrl: new URL('/upgrade', siteUrl).toString(),
        });
    }
  } catch (failure) {
    logError('openCheckout: Checkout failed', failure);
    return { ok: false, code: 'checkout_failed' };
  }
}

type ClaimedCheckoutConfiguration = {
  subscriptions: StripeSubscriptionGateway;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Ends the claim of an attempt, storing its session if it has one. Answers
 * whether the attempt still held the claim, so its session may reach a payer.
 */
async function finishCheckout(
  organizationId: string,
  attempt: number,
  session: StripeCheckoutSession | null,
): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc('finish_werkflow_checkout', {
    p_organization_id: organizationId,
    p_attempt: attempt,
    ...(session
      ? { p_session_id: session.id, p_session_url: session.url, p_expires_at: session.expiresAt }
      : {}),
  });
  if (error) logError('openCheckout: finish_werkflow_checkout failed', error);
  return data === true;
}

/**
 * The attempt this start claimed: the stored Checkout becomes unpayable, and
 * one it saw paid before its signal is recorded; then the attempt's one
 * session. The claim ends in every case, with the session stored or not.
 */
async function claimedCheckout(
  request: CheckoutRequest,
  claim: CheckoutClaim,
  { subscriptions, ...urls }: ClaimedCheckoutConfiguration,
): Promise<CheckoutOutcome> {
  let session: StripeCheckoutSession | null = null;
  try {
    const paid = claim.session_id ? await subscriptions.closeCheckout(claim.session_id) : null;
    if (paid) {
      await recordSubscription(await subscriptions.readSubscription(paid), subscriptions);
      if ((await readOrganizationSubscription(request.organizationId))?.holdsSubscription) {
        await finishCheckout(request.organizationId, claim.attempt, null);
        return { ok: false, code: 'already_subscribed' };
      }
    }
    session = await subscriptions.createCheckoutSession({
      customerId: claim.stripe_customer_id,
      organizationId: request.organizationId,
      attempt: claim.attempt,
      ...urls,
    });
  } catch (failure) {
    logError('openCheckout: Checkout attempt failed', failure);
    await finishCheckout(request.organizationId, claim.attempt, null);
    return { ok: false, code: 'checkout_failed' };
  }
  // A session that is not stored never reaches a payer.
  if (!(await finishCheckout(request.organizationId, claim.attempt, session))) {
    return { ok: false, code: 'checkout_failed' };
  }
  return { ok: true, url: session.url };
}
