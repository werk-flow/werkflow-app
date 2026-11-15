import { NextResponse } from 'next/server';

import { getAuthenticatedUser } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { readOpenReservation } from '@/lib/subscription/helpers';
import { recordSubscription } from '@/lib/subscription/record';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';

// Where Stripe Checkout returns after a payment for a new organization
// (werk-flow/werkflow-planning#248). Checkout's signal can arrive after the
// browser does, so the handler re-reads the caller's own reservation's newest
// subscription from Stripe and records it, as the signal will. It takes
// nothing from the query string. A failed re-read only delays the step: the
// signal records the subscription, and a second Checkout re-reads it first.

function to(path: string, request: Request): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return to('/login', request);
  const reservation = await readOpenReservation(user.id);
  if (!reservation) return to('/dashboard', request);

  const stripe = resolveStripeGateway();
  if (!reservation.holdsSubscription && stripe.ok) {
    try {
      const newest = await stripe.gateway.subscriptions.readNewestSubscription(reservation.stripeCustomerId);
      if (newest) await recordSubscription(newest, stripe.gateway.subscriptions);
    } catch (failure) {
      // best-effort: the signal records the subscription, and the next Checkout re-reads it first.
      logError('upgrade return: subscription re-read failed', failure);
    }
  }
  return to('/onboarding/create-organization', request);
}
