import { createClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';

export function createSupabaseImplicitClient() {
  return createClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      auth: {
        flowType: "implicit",
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true
      }
    }
  );
}








