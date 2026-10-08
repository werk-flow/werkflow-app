import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import { fetchWithTimeout } from './fetch-with-timeout';

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    global: {
      // A stalled request must reject instead of hanging the server action.
      fetch: fetchWithTimeout,
    },
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        try {
          cookieStore.set({
            name,
            value,
            ...options,
            sameSite: options?.sameSite as 'lax' | 'strict' | 'none' | undefined,
          });
        } catch {
          // best-effort: a Server Component cannot write cookies; proxy.ts refreshes the session cookies instead.
        }
      },
      remove(name, options) {
        try {
          cookieStore.set({
            name,
            value: '',
            ...options,
            sameSite: options?.sameSite as 'lax' | 'strict' | 'none' | undefined,
            maxAge: 0,
          });
        } catch {
          // best-effort: a Server Component cannot write cookies; proxy.ts refreshes the session cookies instead.
        }
      },
    },
  });
}

/**
 * Lightweight session check for auth pages. Uses getSession()
 * (cookie read only, no network roundtrip). Returns only a boolean
 * to prevent accidental access to the unverified user object.
 *
 * For pages that need the actual User, use getCachedUser() (which
 * validates via getUser()). For server actions that bypass RLS,
 * use getAuthenticatedUser().
 */
export async function getSupabaseServerSession(): Promise<{ supabase: SupabaseClient; session: boolean }> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  return { supabase, session: !error && !!session };
}
