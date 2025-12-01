import { createSupabaseServerClient } from '@/lib/supabase/server';

export type SubscriptionStatus = 'active' | 'inactive' | 'canceled' | 'trialing';

export type Subscription = {
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
export async function getUserSubscription(
  userId: string
): Promise<Subscription | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    // PGRST116 means no rows returned - user has no subscription
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching subscription:', error);
    return null;
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
    console.error('Error checking organizations:', error);
    return false;
  }

  return (count ?? 0) > 0;
}



