import 'server-only';

import { logError } from '@/lib/logging';
import { readOrganizationSubscription } from '@/lib/subscription/helpers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import { receiveSignal } from '@/lib/werkflow-billing/signals/receive';
import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// The signals that waited for their organization (werk-flow/werkflow-planning#245).
// A card payer's Checkout finalizes and pays the first invoice before the payer
// creates the organization its Stripe customer names (lib/org/actions.ts), so
// `invoice.finalized` and `invoice.paid` fail with
// `werkflow_invoice_organization_unknown` and stay pending in the signal
// ledger. Stripe's next delivery can come hours later, and a sandbox may send
// none. Once the organization exists, its customer's waiting signals run again
// here: each is read back from Stripe by id and handled through the same
// ledger as a delivery (signals/receive.ts), so a claim runs it once and its
// original, number, mails and alarms follow the signal path. A signal that
// fails again stays pending for Stripe's next delivery and the daily comparison.

const WAITING_CODE = 'werkflow_invoice_organization_unknown';
const DAY_MS = 24 * 3_600_000;
/** Stripe keeps events 30 days; an older one cannot be read back. */
const EVENT_DAYS = 30;
/** The newest waiting signals read: a new organization's own are the newest. */
const WAITING_SIGNALS_READ = 100;

const waitingSignalsSchema = z.array(
  z.object({ stripe_event_id: z.string(), stripe_created_at: z.string() }),
);
// A Stripe invoice or credit note names its customer by id.
const eventCustomerSchema = z.object({ data: z.object({ object: z.object({ customer: z.string() }) }) });

/** The ids of the signals that wait for an organization, oldest first. */
async function readWaitingSignals(now: Date): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_billing_signals')
    .select('stripe_event_id, stripe_created_at')
    .eq('state', 'pending')
    .eq('last_failure_code', WAITING_CODE)
    .gte('stripe_created_at', new Date(now.getTime() - EVENT_DAYS * DAY_MS).toISOString())
    .order('stripe_created_at', { ascending: false })
    .order('stripe_event_id', { ascending: false })
    .limit(WAITING_SIGNALS_READ);
  const rows = waitingSignalsSchema.safeParse(data);
  if (error || !rows.success) {
    logError('runSignalsWaitingForOrganization: werkflow_billing_signals read failed', error);
    throw billingFailure('waiting_signals_read_failed');
  }
  // Oldest first, as Stripe sent them; a payment signal issues a missing original as well.
  return rows.data
    .toSorted((left, right) => Date.parse(left.stripe_created_at) - Date.parse(right.stripe_created_at))
    .map((row) => row.stripe_event_id);
}

/** Runs one waiting signal again when its object belongs to `customerId`. */
async function runIfOwn(eventId: string, customerId: string, stripe: StripeGateway): Promise<void> {
  const event = await stripe.readEvent(eventId);
  const owner = eventCustomerSchema.safeParse(event);
  if (!owner.success || owner.data.data.object.customer !== customerId) return;
  const receipt = await receiveSignal(event, stripe);
  if (receipt !== 'settled')
    logError('runSignalsWaitingForOrganization: a waiting signal is still open', receipt);
}

/**
 * Runs the signals that failed because `organizationId` did not exist yet,
 * once it does. Never throws: each signal that does not settle here waits for
 * Stripe's next delivery, as before.
 */
export async function runSignalsWaitingForOrganization(
  organizationId: string,
  now = new Date(),
): Promise<void> {
  try {
    const stripe = resolveStripeGateway();
    if (!stripe.ok) {
      logError('runSignalsWaitingForOrganization: Stripe is not configured', stripe.code);
      return;
    }
    const subscription = await readOrganizationSubscription(organizationId);
    if (!subscription) return;
    for (const eventId of await readWaitingSignals(now)) {
      await runIfOwn(eventId, subscription.stripeCustomerId, stripe.gateway).catch((error: unknown) => {
        // best-effort: the signal stays pending, and Stripe's next delivery runs it.
        logError('runSignalsWaitingForOrganization: a waiting signal failed', error);
      });
    }
  } catch (error) {
    // best-effort: the organization exists; Stripe's next delivery and the daily comparison still cover each signal.
    logError('runSignalsWaitingForOrganization: failed', error);
  }
}
