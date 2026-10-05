import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logging';

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

type SubscriptionStatus = 'active' | 'inactive' | 'canceled' | 'trialing';

type Subscription = {
  id: string;
  user_id: string;
  status: SubscriptionStatus;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Fetches the subscription record for a given user
 */
async function getUserSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();

  if (error) {
    // PGRST116 means no rows returned - user has no subscription
    if (error.code === 'PGRST116') {
      return null;
    }
    logError('Error fetching subscription:', error);
    throw new SubscriptionReadError('subscription_read_failed');
  }

  return data as Subscription;
}

/**
 * Checks if a user has an active subscription
 */
export async function isUserSubscribed(userId: string): Promise<boolean> {
  const subscription = await getUserSubscription(userId);
  return subscription?.status === 'active';
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
