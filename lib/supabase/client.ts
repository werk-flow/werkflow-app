import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      realtime: {
        heartbeatIntervalMs: 15_000,
        reconnectAfterMs: (tries: number) =>
          Math.min(1_000 * 2 ** tries, 30_000),
        timeout: 20_000,
      },
    });
  }
  return browserClient;
}
