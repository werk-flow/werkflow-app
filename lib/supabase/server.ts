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

export async function getSupabaseServerSession() {
  const supabase = await createSupabaseServerClient();
  
  // Use getUser() instead of getSession() for reliable auth checks
  // getSession() only reads from cookies without validation
  // getUser() actually validates the session with Supabase
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  // If there's an error or no user, return null session
  if (error || !user) {
    return { supabase, session: null };
  }

  // Get the session for compatibility with existing code
  const {
    data: { session }
  } = await supabase.auth.getSession();

  return { supabase, session };
}
