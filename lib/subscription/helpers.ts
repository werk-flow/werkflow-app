import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logging';
import type { Database } from '@/lib/supabase/database.types';

/**
 * A subscription or membership read that failed. It is never "not subscribed"
 * or "no organizations": callers let it reach the error boundary or return
 * their own failure, so a paying customer never sees the offer by mistake.
 */
class SubscriptionReadError extends Error {
  constructor(readonly code: 'subscription_read_failed' | 'membership_read_failed') {
    super(code);
    this.name = 'SubscriptionReadError';
  }
}

/**
 * An organization's Stripe subscription as WerkFlow last recorded it
 * (`werkflow_subscriptions`), by the database's two rules.
 * `holdsSubscription`: the organization counts as subscribed; a failed
 * payment never ends it in stage A. `runsSubscription`: Stripe still bills
 * it, so no second Checkout opens; one Stripe ended after a failed first
 * debit holds but no longer runs, and the Admin starts a new one.
 */
export type OrganizationSubscription = {
  organizationId: string;
  stripeCustomerId: string;
  /** The subscription the row follows; null before the first. */
  stripeSubscriptionId: string | null;
  holdsSubscription: boolean;
  runsSubscription: boolean;
  /** The organization's stored Checkout; null when none was stored. */
  checkoutSessionId: string | null;
};

const SUBSCRIPTION_COLUMNS =
  'organization_id, stripe_customer_id, stripe_subscription_id, holds_subscription, runs_subscription, checkout_session_id';

type SubscriptionRow = Pick<
  Database['public']['Tables']['werkflow_subscriptions']['Row'],
  | 'organization_id'
  | 'stripe_customer_id'
  | 'stripe_subscription_id'
  | 'holds_subscription'
  | 'runs_subscription'
  | 'checkout_session_id'
>;

function toSubscription(row: SubscriptionRow): OrganizationSubscription {
  return {
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    holdsSubscription: row.holds_subscription,
    runsSubscription: row.runs_subscription,
    checkoutSessionId: row.checkout_session_id,
  };
}

/** The subscription row of an organization the caller's context resolved; null without one. */
export async function readOrganizationSubscription(
  organizationId: string,
): Promise<OrganizationSubscription | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    logError('readOrganizationSubscription: read failed', error);
    throw new SubscriptionReadError('subscription_read_failed');
  }
  return data ? toSubscription(data) : null;
}

/**
 * The user's open reservation: a Checkout started before the organization
 * exists, whose id the organization takes when the user creates it.
 */
export async function readOpenReservation(userId: string): Promise<OrganizationSubscription | null> {
  // tenant-scope: own-user-row — the signed-in user's own reservation, whose organization does not exist yet.
  const { data, error } = await createSupabaseAdminClient()
    .from('werkflow_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('reserved_by', userId)
    .is('linked_at', null)
    .maybeSingle();
  if (error) {
    logError('readOpenReservation: read failed', error);
    throw new SubscriptionReadError('subscription_read_failed');
  }
  return data ? toSubscription(data) : null;
}

/**
 * Whether onboarding sends a member to the dashboard: not while they name the
 * further organization their paid reservation holds (werk-flow/werkflow-planning#495).
 */
export async function memberLeavesOnboarding(userId: string): Promise<boolean> {
  if (!(await userHasOrganizations(userId))) return false;
  return !(await readOpenReservation(userId))?.holdsSubscription;
}

/**
 * Checks if a user has any organizations
 */
export async function userHasOrganizations(userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { count, error } = await supabase
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    logError('Error checking organizations:', error);
    throw new SubscriptionReadError('membership_read_failed');
  }

  return (count ?? 0) > 0;
}
