import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/mitarbeiter',
  '/onboarding',
  '/upgrade'
];

// App routes that need org cookie validation (not onboarding/upgrade)
const APP_ROUTES_NEEDING_ORG = ['/dashboard', '/mitarbeiter'];

const CURRENT_ORG_COOKIE = 'current_org_id';
const CURRENT_ORG_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/public') ||
    pathname === '/favicon.ico'
  );
}

export async function middleware(req: NextRequest) {
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

  // Handle potential auth errors gracefully (e.g., invalid refresh tokens)
  // Use getUser() instead of getSession() for reliable auth checks
  // getSession() only reads from cookies without validation
  // getUser() actually validates the session with Supabase
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) {
      user = data.user;
    }
  } catch (error) {
    // Silently handle auth errors - treat as no session
    console.error('Auth error in middleware:', error);
  }

  // For backward compatibility, treat user presence as "has session"
  const session = user ? { user } : null;

  const normalizedPath =
    pathname !== '/' && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  const isRoot = normalizedPath === '/';
  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );

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

  // For authenticated users on app routes, ensure org cookie is set
  // This prevents "no org selected" states when user has memberships
  const isAppRoute = APP_ROUTES_NEEDING_ORG.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );

  if (session && user && isAppRoute) {
    const currentOrgCookie = req.cookies.get(CURRENT_ORG_COOKIE)?.value;

    // Fetch user's memberships to validate/set org cookie
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id);

    const memberOrgIds = (memberships ?? []).map((m) => m.organization_id);

    if (memberOrgIds.length > 0) {
      // Check if current cookie is valid
      const isValidCookie =
        currentOrgCookie && memberOrgIds.includes(currentOrgCookie);

      if (!isValidCookie) {
        // Set cookie to first org - this ensures there's ALWAYS an active org
        const firstOrgId = memberOrgIds[0];
        response.cookies.set(CURRENT_ORG_COOKIE, firstOrgId, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: CURRENT_ORG_MAX_AGE,
          path: '/'
        });
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/signup',
    '/dashboard',
    '/mitarbeiter',
    '/onboarding/:path*',
    '/upgrade',
    '/verify',
    '/forgot-password',
    '/reset-password'
  ]
};
