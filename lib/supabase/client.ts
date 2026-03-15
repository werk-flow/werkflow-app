import { createBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        realtime: {
          heartbeatIntervalMs: 15_000,
          reconnectAfterMs: (tries: number) =>
            Math.min(1_000 * 2 ** tries, 30_000),
          timeout: 20_000,
        },
      }
    );
  }
  return browserClient;
}
