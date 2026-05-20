import { createClient } from '@supabase/supabase-js'

import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public'

export function createSupabaseTransientBrowserClient() {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
