import { NextResponse } from 'next/server';

import { logError } from '@/lib/logging';
import { receiveSignal, type SignalReceipt } from '@/lib/werkflow-billing/signals/receive';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';

// Stripe's signals to WerkFlow's own billing (werk-flow/werkflow-planning#250).
// No session: the caller is Stripe, proven by the `Stripe-Signature` header
// over the raw body with STRIPE_WEBHOOK_SECRET, checked before anything of the
// body is parsed or stored. A missing, forged or stale signature answers 400
// and records nothing. A verified event is handled at most once
// (lib/werkflow-billing/signals/receive.ts); any answer but 2xx makes Stripe
// deliver it again, for up to three days. proxy.ts does not run on /api/.

const STATUS_BY_RECEIPT: Record<SignalReceipt, number> = {
  settled: 200,
  malformed: 400,
  busy: 409,
  failed: 500,
  unavailable: 503,
};

function answer(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const stripe = resolveStripeGateway();
  if (!stripe.ok) {
    logError('stripe webhook: configuration refused', stripe.code);
    return answer(503);
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return answer(400);
  const event = await stripe.gateway.verifySignal(await request.text(), signature);
  if (!event) return answer(400);
  return answer(STATUS_BY_RECEIPT[await receiveSignal(event, stripe.gateway)]);
}
