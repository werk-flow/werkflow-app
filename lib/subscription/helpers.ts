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
 * (`werkflow_subscriptions`). `holdsSubscription` is the database's one rule:
 * a failed payment never ends it in stage A.
 */
export type OrganizationSubscription = {
  organizationId: string;
  stripeCustomerId: string;
  /** The subscription the row follows; null before the first. */
  stripeSubscriptionId: string | null;
  holdsSubscription: boolean;
};

const SUBSCRIPTION_COLUMNS =
  'organization_id, stripe_customer_id, stripe_subscription_id, holds_subscription';

type SubscriptionRow = Pick<
  Database['public']['Tables']['werkflow_subscriptions']['Row'],
  'organization_id' | 'stripe_customer_id' | 'stripe_subscription_id' | 'holds_subscription'
>;

function toSubscription(row: SubscriptionRow): OrganizationSubscription {
  return {
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    holdsSubscription: row.holds_subscription,
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
