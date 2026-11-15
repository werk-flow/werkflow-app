import 'server-only';

import Stripe from 'stripe';

import {
  subscriptionCalls,
  type StripeSubscriptionGateway,
} from '@/lib/werkflow-billing/stripe-subscriptions';

// The one gateway every call of WerkFlow's own billing to Stripe goes through
// (werk-flow/werkflow-planning#250, epic #245). Live Stripe is PROD: a live key
// works only where VERCEL_ENV is `production`, a test key only elsewhere, so a
// key in the wrong environment fails closed. A missing or refused key is a
// typed failure of the caller that asked, never an import-time crash of an
// unrelated page. Tests never reach Stripe: they use createFakeStripeGateway
// (lib/testing/fixtures/fake-stripe-gateway.ts). A later child adds each call
// it needs as a method of StripeGateway, on the client below and on the fake.

/**
 * The API version of every request and every signal this code reads. Typed as
 * the SDK's own version, so an SDK upgrade fails the type check until a person
 * reads Stripe's changes and moves both, and the webhook endpoint in Stripe's
 * dashboard, together.
 */
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-10-28.endive';

/** How old a signed signal may be; Stripe's default, which bounds a replay of a captured request. */
const SIGNAL_TOLERANCE_SECONDS = 300;

type StripeConfigurationFailure =
  | 'stripe_secret_key_missing'
  | 'stripe_secret_key_unrecognized'
  | 'stripe_live_key_outside_production'
  | 'stripe_test_key_in_production'
  | 'stripe_webhook_secret_missing';

export type StripeGateway = {
  /**
   * The event when `signature` (the `Stripe-Signature` header) signs exactly
   * `rawBody` with the webhook secret within the tolerance; null for a forged,
   * stale or malformed signal. Nothing of the body is trusted before this.
   */
  verifySignal(rawBody: string, signature: string): Promise<Stripe.Event | null>;
  /** An organization's customer, Checkout and subscription (werk-flow/werkflow-planning#248). */
  subscriptions: StripeSubscriptionGateway;
};

type StripeGatewayResult =
  | { ok: true; gateway: StripeGateway }
  | { ok: false; code: StripeConfigurationFailure };

type StripeEnvironment = Readonly<Record<string, string | undefined>>;

const LIVE_KEY_PREFIXES = ['sk_live_', 'rk_live_'];
const TEST_KEY_PREFIXES = ['sk_test_', 'rk_test_'];

function keyFailure(key: string, production: boolean): StripeConfigurationFailure | null {
  const live = LIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  const test = TEST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (!live && !test) return 'stripe_secret_key_unrecognized';
  if (live && !production) return 'stripe_live_key_outside_production';
  if (test && production) return 'stripe_test_key_in_production';
  return null;
}

/** Verifies a signal with Stripe's own check. */
function signalVerifier(webhooks: Stripe['webhooks'], webhookSecret: string): StripeGateway['verifySignal'] {
  return async (rawBody, signature) => {
    try {
      return await webhooks.constructEventAsync(rawBody, signature, webhookSecret, SIGNAL_TOLERANCE_SECONDS);
    } catch {
      // A forged, stale or unparsable signal; its content is never logged.
      return null;
    }
  };
}

/**
 * The gateway for this deployment, or the code of the configuration that
 * refuses it. Reads `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
 * `VERCEL_ENV` (docs/technical/environments.md, "Credentials").
 */
export function resolveStripeGateway(environment: StripeEnvironment = process.env): StripeGatewayResult {
  const key = environment.STRIPE_SECRET_KEY?.trim();
  if (!key) return { ok: false, code: 'stripe_secret_key_missing' };
  const failure = keyFailure(key, environment.VERCEL_ENV === 'production');
  if (failure) return { ok: false, code: failure };
  const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return { ok: false, code: 'stripe_webhook_secret_missing' };

  const client = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return {
    ok: true,
    gateway: {
      verifySignal: signalVerifier(client.webhooks, webhookSecret),
      subscriptions: subscriptionCalls(client),
    },
  };
}
