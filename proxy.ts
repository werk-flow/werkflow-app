import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isRejectedIdentity } from '@/lib/auth/identity-errors';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import { logError } from '@/lib/logging';

// Every folder under app/(app) plus the two authenticated areas outside it.
// lib/security/proxy-prefixes.test.ts fails when a shipped route area is
// missing here or from the matcher below (SI-012). The proxy only routes;
// app/(app)/layout.tsx and each action re-check identity.
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/kalender',
  '/zeiterfassung',
  '/mitarbeiter',
  '/kunden',
  '/anfragen',
  '/auftraege',
  '/arbeitsvorlagen',
  '/aufgaben',
  '/qualifikationen',
  '/service',
  '/dokumente',
  '/inventar',
  '/einstellungen',
  '/onboarding',
  '/upgrade',
];

function isStaticAsset(pathname: string) {
  return pathname.startsWith('/_next') || pathname.startsWith('/public') || pathname === '/favicon.ico';
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: Parameters<typeof response.cookies.set>[2] }[],
      ) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: req.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set({ name, value, ...options }));
      },
    },
  });

  const normalizedPath = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const isRoot = normalizedPath === '/';
  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );

  // Cookie-only session check (no network roundtrip) to keep the proxy
  // fast (~1ms). Only checks whether a session cookie exists — does NOT
  // validate the JWT. Full validation happens in server actions via
  // getAuthenticatedUser(), and page data queries are protected by RLS.
  //
  // We intentionally avoid accessing session.user to prevent the
  // Supabase "insecure user object" console warning. The proxy only
  // needs to know whether a session exists for routing decisions.
  //
  // getSession() refreshes an expired token over the network. When that
  // refresh cannot complete (a thrown failure, or an error that is not one of
  // Auth's rejections), the visitor is not signed out: the request passes, and
  // the layout's identity check shows the failure page instead of a login
  // redirect (security.md, rule 8). `isRejectedIdentity` is the same
  // classification getAuthenticatedUser applies.
  let hasSession = false;
  let authUnavailable = false;
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    hasSession = !!session;
    authUnavailable = !session && error !== null && !isRejectedIdentity(error);
    if (authUnavailable) logError('Auth refresh unavailable in proxy', error);
  } catch (error) {
    authUnavailable = true;
    logError('Auth refresh threw in proxy', error);
  }
  if (authUnavailable) return response;

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
    '/zeiterfassung/:path*',
    '/mitarbeiter/:path*',
    '/kunden/:path*',
    '/anfragen/:path*',
    '/auftraege/:path*',
    '/arbeitsvorlagen/:path*',
    '/aufgaben/:path*',
    '/qualifikationen/:path*',
    '/service/:path*',
    '/dokumente/:path*',
    '/inventar/:path*',
    '/einstellungen/:path*',
    '/onboarding/:path*',
    '/upgrade',
    '/verify',
    '/forgot-password',
    '/reset-password',
  ],
};
