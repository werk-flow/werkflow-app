import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public'

export function createSupabaseTransientBrowserClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
