'use server';

import { redirect } from 'next/navigation';
import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { userHasOrganizations } from './helpers';
import { getAuthenticatedUser, CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { consumeRateLimit } from '@/lib/security/rate-limit';

export type SimulatePaymentResult = {
  success: boolean;
  error?: string;
};

/**
 * Simulates a successful payment by activating the user's subscription.
 * This is a placeholder for actual Stripe integration.
 */
export async function simulatePayment(): Promise<SimulatePaymentResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  // Check if user already has organizations - if so, redirect to dashboard
  let hasOrgs: boolean;
  try {
    hasOrgs = await userHasOrganizations(user.id);
  } catch {
    return { success: false, error: 'subscription_activation_failed' };
  }
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // Activation runs once per account; repeated calls are automation. A
  // limiter that cannot decide refuses with a retryable failure (rate-limit.ts).
  const verdict = await consumeRateLimit({ action: 'subscription_activation_per_user', subject: user.id });
  if (verdict === 'limited') {
    return { success: false, error: 'too_many_attempts' };
  }
  if (verdict === 'unavailable') {
    return { success: false, error: 'subscription_activation_failed' };
  }

  // Use admin client for subscription operations (no INSERT/UPDATE policy)
  const admin = createSupabaseAdminClient();

  // Upsert subscription record with active status using admin client
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      status: 'active',
      plan_id: 'dev_plan', // Placeholder plan ID for development
    },
    {
      onConflict: 'user_id',
    },
  );

  if (error) {
    logError('simulatePayment: subscription upsert failed', error);
    return { success: false, error: 'subscription_activation_failed' };
  }

  updateTag(CACHE_TAGS.subscription(user.id));

  // Redirect to organization creation page
  redirect('/onboarding/create-organization');
}
