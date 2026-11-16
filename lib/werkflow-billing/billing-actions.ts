'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createWerkflowBillingDownloadUrl } from '@/lib/storage/r2';
import { recordSnapshot } from '@/lib/subscription/record';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  billingGateway,
  readSubscriptionRow,
  resolveBillingAdmin,
} from '@/lib/werkflow-billing/billing-page';
import type { WerkflowBillingFailureCode } from '@/lib/werkflow-billing/billing-messages';
import { subscriptionRowOf, subscriptionViewOf } from '@/lib/werkflow-billing/billing-view';
import type { StripeSubscriptionSnapshot } from '@/lib/werkflow-billing/stripe-subscriptions';

// The billing page's actions (werk-flow/werkflow-planning#252). Only the
// organization's Admin cancels the subscription, takes the cancellation back
// or opens an invoice; every action resolves the caller on the server first.
// The subscription comes from WerkFlow's record of the organization, never
// from the client; whether it may change is judged on Stripe's current state. A cancellation takes effect at the end of the paid period
// (owner, 2026-11-15): Stripe's `cancel_at_period_end`, no partial refund.

type BillingActionResult<Data = object> = ActionResult<Data, WerkflowBillingFailureCode>;

/**
 * A changed cancellation. `shown` is false when Stripe holds the change but
 * WerkFlow's record of it failed: the page shows it once the subscription
 * signal records it, and the next change judges Stripe's state, not the record.
 */
type CancellationResult = BillingActionResult<{ shown: boolean }>;

/**
 * Records Stripe's read of the organization's own subscription; false when
 * the record failed. A read no newer than the stored one changes nothing.
 */
async function recordRead(organizationId: string, snapshot: StripeSubscriptionSnapshot): Promise<boolean> {
  try {
    await recordSnapshot(organizationId, snapshot);
    return true;
  } catch (error) {
    logError('changeCancellation: recording the subscription failed', error);
    return false;
  }
}

async function changeCancellation(
  organizationId: string,
  cancelAtPeriodEnd: boolean,
): Promise<CancellationResult> {
  const admin = await resolveBillingAdmin(organizationId);
  if (!admin.success) return admin;
  const refusal = cancelAtPeriodEnd ? 'subscription_not_cancellable' : 'subscription_not_resumable';

  let subscriptionId: string | null;
  try {
    subscriptionId = (await readSubscriptionRow(admin.context.orgId))?.stripe_subscription_id ?? null;
  } catch (error) {
    logError('changeCancellation: subscription read failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!subscriptionId) return { success: false, error: refusal };

  const gateway = billingGateway();
  if (!gateway) return { success: false, error: 'stripe_unavailable' };
  let current: StripeSubscriptionSnapshot;
  try {
    current = await gateway.subscriptions.readSubscription(subscriptionId);
  } catch (error) {
    logError('changeCancellation: Stripe refused the read', error);
    return { success: false, error: 'stripe_unavailable' };
  }
  // Judged on Stripe's current state: WerkFlow's record lags behind a change whose record failed.
  const view = subscriptionViewOf(subscriptionRowOf(current), new Date());
  if (!(cancelAtPeriodEnd ? view?.canCancel : view?.canResume)) {
    // The refusal brings the record up to Stripe, so the reloaded page offers the right step.
    await recordRead(admin.context.orgId, current);
    return { success: false, error: refusal };
  }
  let changed: StripeSubscriptionSnapshot;
  try {
    changed = await gateway.subscriptions.setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd);
  } catch (error) {
    logError('changeCancellation: Stripe refused the change', error);
    return { success: false, error: 'stripe_unavailable' };
  }
  return { success: true, shown: await recordRead(admin.context.orgId, changed) };
}

/** Ends the organization's subscription at the end of the paid period. */
export async function cancelWerkflowSubscription(rawOrganizationId: unknown): Promise<CancellationResult> {
  const organizationId = uuidSchema.safeParse(rawOrganizationId);
  if (!organizationId.success) return { success: false, error: 'invalid_input' };
  return changeCancellation(organizationId.data, true);
}

/** Takes a cancellation back while the paid period runs. */
export async function resumeWerkflowSubscription(rawOrganizationId: unknown): Promise<CancellationResult> {
  const organizationId = uuidSchema.safeParse(rawOrganizationId);
  if (!organizationId.success) return { success: false, error: 'invalid_input' };
  return changeCancellation(organizationId.data, false);
}

/** A short-lived download URL of one of the organization's invoice originals. */
export async function openWerkflowInvoice(
  rawOrganizationId: unknown,
  rawInvoiceId: unknown,
): Promise<BillingActionResult<{ url: string }>> {
  const organizationId = uuidSchema.safeParse(rawOrganizationId);
  const invoiceId = uuidSchema.safeParse(rawInvoiceId);
  if (!organizationId.success || !invoiceId.success) return { success: false, error: 'invalid_input' };
  const admin = await resolveBillingAdmin(organizationId.data);
  if (!admin.success) return admin;
  try {
    // The invoice must be the organization's: another organization's id answers like an unknown one.
    const { data, error } = await createSupabaseAdminClient()
      .from('werkflow_invoices')
      .select('number, file_key')
      .eq('id', invoiceId.data)
      .eq('organization_id', admin.context.orgId)
      .maybeSingle();
    if (error) throw new Error('invoice_read_failed', { cause: error });
    if (!data) return { success: false, error: 'invoice_not_found' };
    const url = await createWerkflowBillingDownloadUrl({
      path: data.file_key,
      downloadFileName: `WerkFlow-Rechnung-${data.number}.pdf`,
    });
    return { success: true, url };
  } catch (error) {
    logError('openWerkflowInvoice failed', error);
    return { success: false, error: 'invoice_download_failed' };
  }
}
