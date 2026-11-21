import { connection } from 'next/server';

import { logError } from '@/lib/logging';
import { cronRequestAccess } from '@/lib/security/shared-secret';
import { reconcileWerkflowBilling } from '@/lib/werkflow-billing/reconciliation';
import { resolveStripeGateway } from '@/lib/werkflow-billing/stripe';

// Vercel Cron calls this daily (vercel.json): the comparison of WerkFlow's
// billing with Stripe (lib/werkflow-billing/reconciliation.ts). A missing
// CRON_SECRET or Stripe key answers 503 and an incomplete run 500, so the
// production watcher reports the route; a wrong secret answers 404. The body
// holds counts only. connection() declares the handler dynamic under
// cacheComponents.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  await connection();
  const access = cronRequestAccess(request.headers);
  if (access === 'unconfigured') {
    logError('werkflow billing reconciliation: CRON_SECRET is not configured');
    return new Response(null, { status: 503, headers: NO_STORE });
  }
  if (access === 'refused') return new Response(null, { status: 404, headers: NO_STORE });
  const stripe = resolveStripeGateway();
  if (!stripe.ok) {
    logError('werkflow billing reconciliation: Stripe is not configured', stripe.code);
    return new Response(null, { status: 503, headers: NO_STORE });
  }
  const run = await reconcileWerkflowBilling(stripe.gateway);
  return Response.json(run, { status: run.complete ? 200 : 500, headers: NO_STORE });
}
