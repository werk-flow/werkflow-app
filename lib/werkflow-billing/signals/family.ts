import type Stripe from 'stripe';

import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

/**
 * One family of Stripe signals and its handler. Each family lives in its own
 * file in this folder, and only the child that owns the family changes it.
 *
 * The handler's contract:
 * - Input: an event whose signature the endpoint verified, and the gateway.
 *   It re-reads the Stripe object by id through the gateway instead of
 *   trusting the event body, and finds the organization only through the
 *   Stripe customer's `werkflow_organization_id` metadata.
 * - Idempotent: a second run for the same event changes nothing more.
 * - Returns when done; the endpoint then marks the signal handled for good.
 * - Throws on any failure, so the endpoint answers 5xx and Stripe delivers the
 *   event again. A thrown error's `code`, when it is a stable code, is kept
 *   with the signal; never put personal data or a provider body in it.
 */
export type SignalFamily = {
  eventTypes: readonly Stripe.Event.Type[];
  handle(event: Stripe.Event, stripe: StripeGateway): Promise<void>;
};
