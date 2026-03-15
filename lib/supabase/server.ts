import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
 * Lightweight session check for pages/components. Uses getSession()
 * (cookie read only, no network roundtrip). Suitable for page-level
 * auth guards that only need to know if a session cookie exists;
 * the actual data queries on those pages go through RLS-protected
 * clients. Server actions that use the admin client (bypassing RLS)
 * must use getAuthenticatedUser() which validates via getUser().
 */
export async function getSupabaseServerSession() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error || !session) {
    return { supabase, session: null };
  }

  return { supabase, session };
}
