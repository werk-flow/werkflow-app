import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
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
              sameSite: options?.sameSite as
                | 'lax'
                | 'strict'
                | 'none'
                | undefined
            });
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name, options) {
          try {
            cookieStore.set({
              name,
              value: '',
              ...options,
              sameSite: options?.sameSite as
                | 'lax'
                | 'strict'
                | 'none'
                | undefined,
              maxAge: 0
            });
          } catch {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        }
      }
    }
  );
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
export async function getSupabaseServerSession() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  return { supabase, session: !error && !!session };
}
