import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../../lib/supabase/database.types';
import { testSupabaseClientOptions } from './client-options';
import { requireEnv } from './env';

/**
 * Every test starts without persisted per-user UI preferences (calendar view,
 * horizon, filters, the read-only lock, list columns). A value a previous test
 * left in `organization_user_preferences` is that test's history, never the
 * next test's evidence: nine of the P1-24a campaign's failures were exactly
 * that leak. A test that proves persistence does so inside its own run.
 */
export async function resetPersistedPreferences(organizationIds: readonly string[]): Promise<void> {
  const admin = createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), testSupabaseClientOptions);
  const { error } = await admin.from('organization_user_preferences').delete().in('organization_id', [...organizationIds]);
  if (error) throw new Error(`Preference reset failed: ${error.message}`);
}
