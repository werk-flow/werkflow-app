import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContextFor, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  invoiceViewOf,
  subscriptionViewOf,
  type SubscriptionRow,
  type SubscriptionView,
  type WerkflowInvoiceView,
} from '@/lib/werkflow-billing/billing-view';
import type { WerkflowBillingFailureCode } from '@/lib/werkflow-billing/billing-messages';
import { resolveStripeGateway, type StripeGateway } from '@/lib/werkflow-billing/stripe';
import type { StripeBillingOutlook } from '@/lib/werkflow-billing/stripe-subscriptions';

// The billing page's reads (werk-flow/werkflow-planning#252). WerkFlow's
// invoices and subscription are the organization Admin's business only: each
// read resolves the caller on the server and refuses Büro, employees and a
// caller who is not a member of the organization asked for. The page reads
// WerkFlow's records and asks Stripe only for the next renewal and the
// payment method.

type BillingResult<Data> = ActionResult<Data, WerkflowBillingFailureCode>;

const SUBSCRIPTION_COLUMNS =
  'stripe_subscription_id, status, cancellation_reason, cancel_at_period_end, current_period_end';
const INVOICE_COLUMNS =
  'id, number, issue_date, type_code, line_names, service_start, service_end, gross_cents, due_cents';

/** The caller as the Admin of the organization asked for, or the refusal. */
export async function resolveBillingAdmin(
  rawOrganizationId: unknown,
): Promise<BillingResult<{ context: ActionContext }>> {
  const organizationId = uuidSchema.safeParse(rawOrganizationId);
  if (!organizationId.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContextFor(organizationId.data);
  if (!caller.success) return caller;
  if (caller.context.role !== 'admin') return { success: false, error: 'not_authorized' };
  return caller;
}

/** The organization's subscription row; throws on a failed read, which is never "no subscription". */
export async function readSubscriptionRow(organizationId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error('subscription_read_failed', { cause: error });
  return data;
}

async function readInvoices(organizationId: string): Promise<WerkflowInvoiceView[]> {
  // The caller's own client: the Admin-only policy holds behind the role check above.
  const client = await createSupabaseServerClient();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      client
        .from('werkflow_invoices')
        .select(INVOICE_COLUMNS)
        .eq('organization_id', organizationId)
        .order('issue_date', { ascending: false })
        .order('number', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) throw new Error('invoice_read_failed', { cause: error });
  return data.map(invoiceViewOf);
}

export type WerkflowBilling = {
  /** Null before the organization's first subscription, as for a pilot organization. */
  subscription: SubscriptionView | null;
  invoices: WerkflowInvoiceView[];
};

/** The subscription and every invoice of the organization, from WerkFlow's records. */
export async function readWerkflowBilling(
  organizationId: unknown,
): Promise<BillingResult<{ billing: WerkflowBilling }>> {
  const admin = await resolveBillingAdmin(organizationId);
  if (!admin.success) return admin;
  const { orgId } = admin.context;
  try {
    const [row, invoices] = await Promise.all([readSubscriptionRow(orgId), readInvoices(orgId)]);
    return { success: true, billing: { subscription: subscriptionViewOf(row, new Date()), invoices } };
  } catch (error) {
    logError('readWerkflowBilling: read failed', error);
    return { success: false, error: 'load_failed' };
  }
}

/** The gateway of this deployment; its refusal is logged by code only. */
export function billingGateway(): StripeGateway | null {
  const resolved = resolveStripeGateway();
  if (resolved.ok) return resolved.gateway;
  logError('billing: the Stripe gateway is not configured', resolved.code);
  return null;
}

/** Stripe's next renewal and the payment method; null without a subscription. */
export async function readWerkflowBillingOutlook(
  organizationId: unknown,
): Promise<BillingResult<{ outlook: StripeBillingOutlook | null }>> {
  const admin = await resolveBillingAdmin(organizationId);
  if (!admin.success) return admin;
  try {
    const subscriptionId = (await readSubscriptionRow(admin.context.orgId))?.stripe_subscription_id;
    if (!subscriptionId) return { success: true, outlook: null };
    const gateway = billingGateway();
    if (!gateway) return { success: false, error: 'stripe_unavailable' };
    return { success: true, outlook: await gateway.subscriptions.readBillingOutlook(subscriptionId) };
  } catch (error) {
    logError('readWerkflowBillingOutlook: read failed', error);
    return { success: false, error: 'stripe_unavailable' };
  }
}
