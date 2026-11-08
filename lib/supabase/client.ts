import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import type { Database } from './database.types';

let browserClient: SupabaseClient<Database> | null = null;

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
      // Tokens or a code in a page URL never sign anyone in or out. Every link
      // that carries them goes to /auth/callback, which redeems it on the server.
      auth: { detectSessionInUrl: false },
      realtime: {
        heartbeatIntervalMs: 15_000,
        reconnectAfterMs: (tries: number) => Math.min(1_000 * 2 ** tries, 30_000),
        timeout: 20_000,
      },
    });
  }
  return browserClient;
}
