import 'server-only';

import type Stripe from 'stripe';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import { receiveSignal, type SignalReceipt } from '@/lib/werkflow-billing/signals/receive';
import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';
import { z } from '@/lib/zod';

// The signals that waited for their organization (werk-flow/werkflow-planning#245).
// A card payer's Checkout finalizes and pays the first invoice before the payer
// creates the organization its Stripe customer names (lib/org/actions.ts), so
// `invoice.finalized` and `invoice.paid` fail with
// `werkflow_invoice_organization_unknown` and stay pending in the signal
// ledger. Stripe's next delivery can come hours later, and a sandbox may send
// none. Two paths run such a signal again, each through the same ledger as a
// delivery (signals/receive.ts), so a claim runs it once and its original,
// number, mails and alarms follow the signal path:
// 1. once the organization exists, its customer's waiting signals, each read
//    back from Stripe by id;
// 2. a delivery that fails this way after the organization was created
//    meanwhile, right after its failure is recorded.
// Whichever of the creation and the recorded failure commits last finds the
// other. A signal that fails again waits for Stripe's next delivery and the
// daily comparison.

const WAITING_CODE = 'werkflow_invoice_organization_unknown';
const MINUTE_MS = 60_000;
/** Stripe's clock and the database's may differ by this much. */
const CLOCK_SKEW_MS = 10 * MINUTE_MS;
/** Stripe keeps events 30 days; an older one cannot be read back. */
const EVENT_MS = 30 * 24 * 60 * MINUTE_MS;
/**
 * More signals waiting for an organization than this is an outage, not
 * WerkFlow's volume. One response under PostgREST's row cap holds them and the
 * row that shows an overflow.
 */
const WAITING_SIGNALS_CAP = ROW_PAGE_SIZE - 1;

const waitingSignalSchema = z.object({ stripe_event_id: z.string() });
const subscriptionSchema = z.object({ stripe_customer_id: z.string(), created_at: z.string() });
// A Stripe invoice or credit note names its customer by id.
const eventCustomerSchema = z.object({ data: z.object({ object: z.object({ customer: z.string() }) }) });

/** The customer of a Stripe event's object; null when it names none. */
function customerOf(event: Stripe.Event): string | null {
  const parsed = eventCustomerSchema.safeParse(event);
  return parsed.success ? parsed.data.data.object.customer : null;
}

/**
 * The ids of the signals that wait for an organization since `since`, oldest
 * first, in one read; more than the cap fails the read instead of leaving any out.
 */
async function readWaitingSignals(since: string): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_billing_signals')
    .select('stripe_event_id')
    .eq('state', 'pending')
    .eq('last_failure_code', WAITING_CODE)
    .gte('stripe_created_at', since)
    .order('stripe_created_at')
    .order('stripe_event_id')
    .limit(WAITING_SIGNALS_CAP + 1);
  const rows = waitingSignalSchema.array().safeParse(data);
  if (error || !rows.success) {
    logError('runSignalsWaitingForOrganization: werkflow_billing_signals read failed', error);
    throw billingFailure('waiting_signals_read_failed');
  }
  if (rows.data.length > WAITING_SIGNALS_CAP) throw billingFailure('waiting_signals_overflow');
  return rows.data.map((row) => row.stripe_event_id);
}

/** The organization's Stripe customer and when its Checkout reserved it; null without a subscription row. */
async function readSubscription(organizationId: string): Promise<z.infer<typeof subscriptionSchema> | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_subscriptions')
    .select('stripe_customer_id, created_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const row = subscriptionSchema.nullable().safeParse(data);
  if (error || !row.success) {
    logError('runSignalsWaitingForOrganization: werkflow_subscriptions read failed', error);
    throw billingFailure('waiting_signals_read_failed');
  }
  return row.data;
}

/** Runs one waiting signal again when its object belongs to `customerId`. */
async function runIfOwn(eventId: string, customerId: string, stripe: StripeGateway): Promise<void> {
  const event = await stripe.readEvent(eventId);
  if (customerOf(event) !== customerId) return;
  const receipt = await receiveSignal(event, stripe);
  if (receipt !== 'settled') {
    logError('runSignalsWaitingForOrganization: a waiting signal is still open', receipt);
  }
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
    const subscription = await readSubscription(organizationId);
    if (!subscription) return;
    // The customer's signals all follow its Checkout, which its row precedes.
    const since = Math.max(Date.parse(subscription.created_at) - CLOCK_SKEW_MS, now.getTime() - EVENT_MS);
    for (const eventId of await readWaitingSignals(new Date(since).toISOString())) {
      await runIfOwn(eventId, subscription.stripe_customer_id, stripe.gateway).catch((error: unknown) => {
        // best-effort: the signal stays pending, and Stripe's next delivery runs it.
        logError('runSignalsWaitingForOrganization: a waiting signal failed', error);
      });
    }
  } catch (error) {
    // best-effort: each signal stays pending; Stripe's next delivery runs it, and the daily comparison raises an alarm for an invoice still without its original.
    logError('runSignalsWaitingForOrganization: failed', error);
  }
}

/** Whether the ledger keeps `eventId` as failed only for want of its organization. */
async function waitsForOrganization(eventId: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_billing_signals')
    .select('last_failure_code')
    .eq('stripe_event_id', eventId)
    .maybeSingle();
  if (error) throw billingFailure('waiting_signals_read_failed');
  return data?.last_failure_code === WAITING_CODE;
}

/** Whether the organization a Stripe customer reserved exists now. */
async function customerHasOrganization(customerId: string): Promise<boolean> {
  // tenant-scope: cross-organization-by-design — the Stripe customer of a verified signal names its one subscription row.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_subscriptions')
    .select('linked_at')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw billingFailure('waiting_signals_read_failed');
  return typeof data?.linked_at === 'string';
}

/**
 * The receipt of a verified signal's delivery. One that failed only because
 * its organization did not exist yet, while the organization was created
 * meanwhile, runs once more: the creation's own run may have read the ledger
 * before this failure.
 */
export async function runAgainOnceItsOrganizationExists(
  event: Stripe.Event,
  stripe: StripeGateway,
  receipt: SignalReceipt,
): Promise<SignalReceipt> {
  if (receipt !== 'failed') return receipt;
  const customerId = customerOf(event);
  try {
    if (!customerId || !(await waitsForOrganization(event.id))) return receipt;
    if (!(await customerHasOrganization(customerId))) return receipt;
  } catch (error) {
    // best-effort: the failed signal stays pending, and Stripe's next delivery runs it.
    logError('runAgainOnceItsOrganizationExists: recheck failed', error);
    return receipt;
  }
  return receiveSignal(event, stripe);
}
