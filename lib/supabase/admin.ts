// Enforcement ladder Tier 1 (decision 0005): the service-role client bypasses
// RLS — importing it from a client component must be a build error, not a
// prose rule.
import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/lib/env/public';
import { getSupabaseSecretKey } from '@/lib/env/server';
import { fetchWithTimeout } from './fetch-with-timeout';

let _adminClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client with admin/service role privileges.
 * The client has no cookie/session dependency and is safe to reuse across
 * requests within the same server process.
 *
 * Use this ONLY in server-side code. Never expose to the browser.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseSecretKey();

  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      // A stalled request must reject instead of hanging the server action.
      fetch: fetchWithTimeout
    }
  });

  return _adminClient;
}
