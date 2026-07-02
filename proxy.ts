import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';


const PROTECTED_PREFIXES = [
  '/dashboard',
  '/kalender',
  '/zeiterfassung',
  '/mitarbeiter',
  '/kunden',
  '/auftraege',
  '/dokumente',
  '/einstellungen',
  '/onboarding',
  '/upgrade'
];

function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/public') ||
    pathname === '/favicon.ico'
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: req.headers
    }
  });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: Parameters<typeof response.cookies.set>[2] }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: {
              headers: req.headers
            }
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const normalizedPath =
    pathname !== '/' && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  const isRoot = normalizedPath === '/';
  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );

  // Cookie-only session check (no network roundtrip) to keep the proxy
  // fast (~1ms). Only checks whether a session cookie exists — does NOT
  // validate the JWT. Full validation happens in server actions via
  // getAuthenticatedUser(), and page data queries are protected by RLS.
  //
  // We intentionally avoid accessing session.user to prevent the
  // Supabase "insecure user object" console warning. The proxy only
  // needs to know whether a session exists for routing decisions.
  let hasSession = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    hasSession = !!session;
  } catch (error) {
    console.error('Auth error in proxy:', error);
  }

  const isVerifyRoute = normalizedPath === '/verify';

  if (isVerifyRoute && !hasSession) {
    const emailParam = req.nextUrl.searchParams.get('email');
    if (!emailParam) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/signup';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }
  }

  const shouldRedirectToLogin = !hasSession && (isProtectedRoute || isRoot);

  if (shouldRedirectToLogin) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/signup',
    '/dashboard',
    '/kalender',
    '/zeiterfassung',
    '/mitarbeiter/:path*',
    '/kunden/:path*',
    '/auftraege/:path*',
    '/dokumente/:path*',
    '/einstellungen/:path*',
    '/onboarding/:path*',
    '/upgrade',
    '/verify',
    '/forgot-password',
    '/reset-password'
  ]
};
