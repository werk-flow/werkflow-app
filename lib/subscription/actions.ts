'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { userHasOrganizations } from './helpers';

export type SimulatePaymentResult = {
  success: boolean;
  error?: string;
};

/**
 * Simulates a successful payment by activating the user's subscription.
 * This is a placeholder for actual Stripe integration.
 */
export async function simulatePayment(): Promise<SimulatePaymentResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  // Check if user already has organizations - if so, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // Use admin client for subscription operations (no INSERT/UPDATE policy)
  const admin = createSupabaseAdminClient();

  // Upsert subscription record with active status using admin client
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      status: 'active',
      plan_id: 'dev_plan' // Placeholder plan ID for development
    },
    {
      onConflict: 'user_id'
    }
  );

  if (error) {
    console.error('Error activating subscription:', error);
    return { success: false, error: 'subscription_activation_failed' };
  }

  // Redirect to organization creation page
  redirect('/onboarding/create-organization');
}
