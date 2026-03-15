import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/kalender',
  '/zeiterfassung',
  '/mitarbeiter',
  '/kunden',
  '/auftraege',
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
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          req.cookies.set({
            name,
            value,
            ...options
          });
          response = NextResponse.next({
            request: {
              headers: req.headers
            }
          });
          response.cookies.set({
            name,
            value,
            ...options
          });
        },
        remove(name: string, options: any) {
          req.cookies.set({
            name,
            value: '',
            ...options
          });
          response = NextResponse.next({
            request: {
              headers: req.headers
            }
          });
          response.cookies.set({
            name,
            value: '',
            ...options
          });
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

  // Use getSession() (cookie-only, no network roundtrip) for ALL routes.
  // This keeps the proxy fast (~1ms) so loading skeletons can appear
  // instantly. This only checks whether a session cookie exists — it does
  // NOT validate the JWT with Supabase Auth servers. Full validation
  // happens in server actions via getAuthenticatedUser() (which calls
  // getUser()), and page data queries are protected by RLS.
  let user = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    user = session?.user ?? null;
  } catch (error) {
    console.error('Auth error in proxy:', error);
  }

  const session = user ? { user } : null;

  const isVerifyRoute = normalizedPath === '/verify';

  if (isVerifyRoute && session) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (isVerifyRoute && !session) {
    const emailParam = req.nextUrl.searchParams.get('email');
    if (!emailParam) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/signup';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }
  }

  const shouldRedirectToLogin = !session && (isProtectedRoute || isRoot);

  if (shouldRedirectToLogin) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  if (session && isRoot) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
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
    '/onboarding/:path*',
    '/upgrade',
    '/verify',
    '/forgot-password',
    '/reset-password'
  ]
};
