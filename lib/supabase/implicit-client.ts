import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';

export function createSupabaseImplicitClient(): SupabaseClient {
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








