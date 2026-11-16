'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createWerkflowBillingDownloadUrl } from '@/lib/storage/r2';
import { recordSubscription } from '@/lib/subscription/record';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  billingGateway,
  readSubscriptionRow,
  resolveBillingAdmin,
} from '@/lib/werkflow-billing/billing-page';
import type { WerkflowBillingFailureCode } from '@/lib/werkflow-billing/billing-messages';
import { subscriptionViewOf } from '@/lib/werkflow-billing/billing-view';
import type { StripeSubscriptionSnapshot } from '@/lib/werkflow-billing/stripe-subscriptions';

// The billing page's actions (werk-flow/werkflow-planning#252). Only the
// organization's Admin cancels the subscription, takes the cancellation back
// or opens an invoice; every action resolves the caller on the server first.
// The subscription comes from WerkFlow's record of the organization, never
// from the client. A cancellation takes effect at the end of the paid period
// (owner, 2026-11-15): Stripe's `cancel_at_period_end`, no partial refund.

type BillingActionResult<Data = object> = ActionResult<Data, WerkflowBillingFailureCode>;

async function changeCancellation(
  organizationId: unknown,
  cancelAtPeriodEnd: boolean,
): Promise<BillingActionResult> {
  const admin = await resolveBillingAdmin(organizationId);
  if (!admin.success) return admin;
  const refusal = cancelAtPeriodEnd ? 'subscription_not_cancellable' : 'subscription_not_resumable';

  let subscriptionId: string;
  try {
    const row = await readSubscriptionRow(admin.context.orgId);
    const view = subscriptionViewOf(row, new Date());
    const allowed = cancelAtPeriodEnd ? view?.canCancel : view?.canResume;
    if (!allowed || !row?.stripe_subscription_id) return { success: false, error: refusal };
    subscriptionId = row.stripe_subscription_id;
  } catch (error) {
    logError('changeCancellation: subscription read failed', error);
    return { success: false, error: 'load_failed' };
  }

  const gateway = billingGateway();
  if (!gateway) return { success: false, error: 'stripe_unavailable' };
  let snapshot: StripeSubscriptionSnapshot;
  try {
    snapshot = await gateway.subscriptions.setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd);
  } catch (error) {
    logError('changeCancellation: Stripe refused the change', error);
    return { success: false, error: 'stripe_unavailable' };
  }
  try {
    await recordSubscription(snapshot, gateway.subscriptions);
  } catch (error) {
    // best-effort: Stripe holds the change, and its subscription signal records it on delivery.
    logError('changeCancellation: recording the changed subscription failed', error);
  }
  return { success: true };
}

/** Ends the organization's subscription at the end of the paid period. */
export async function cancelWerkflowSubscription(organizationId: unknown): Promise<BillingActionResult> {
  return changeCancellation(organizationId, true);
}

/** Takes a cancellation back while the paid period runs. */
export async function resumeWerkflowSubscription(organizationId: unknown): Promise<BillingActionResult> {
  return changeCancellation(organizationId, false);
}

/** A short-lived download URL of one of the organization's invoice originals. */
export async function openWerkflowInvoice(
  organizationId: unknown,
  rawInvoiceId: unknown,
): Promise<BillingActionResult<{ url: string }>> {
  const invoiceId = uuidSchema.safeParse(rawInvoiceId);
  if (!invoiceId.success) return { success: false, error: 'invalid_input' };
  const admin = await resolveBillingAdmin(organizationId);
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
