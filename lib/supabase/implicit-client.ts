import { createClient } from "@supabase/supabase-js";

export function createSupabaseImplicitClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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






