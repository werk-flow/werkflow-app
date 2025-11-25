import { NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const type = searchParams.get('type');

  // Determine the redirect destination based on the auth type
  let redirectTo = next;
  if (type === 'recovery') {
    redirectTo = '/reset-password';
  }

  if (code) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return req.cookies.get(name)?.value;
          },
          set(name, value, options) {
            res.cookies.set({ name, value, ...(options ?? {}) });
          },
          remove(name, options) {
            if (options) {
              res.cookies.delete({ name, ...options });
            } else {
              res.cookies.delete(name);
            }
          }
        }
      }
    );

    // Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return res;
    }

    // If code exchange failed, redirect to error page or forgot-password
    console.error('Code exchange error:', error);
    return NextResponse.redirect(
      `${origin}/forgot-password?error=invalid_code`
    );
  }

  // If no code, redirect to home
  return NextResponse.redirect(`${origin}/`);
}

export async function POST(req: NextRequest) {
  const { event, session } = await req.json();

  const res = NextResponse.json({ success: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value;
        },
        set(name, value, options) {
          res.cookies.set({ name, value, ...(options ?? {}) });
        },
        remove(name, options) {
          if (options) {
            res.cookies.delete({ name, ...options });
          } else {
            res.cookies.delete(name);
          }
        }
      }
    }
  );

  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    await supabase.auth.setSession(session);
  }

  if (event === 'SIGNED_OUT') {
    await supabase.auth.signOut();
  }

  return res;
}
