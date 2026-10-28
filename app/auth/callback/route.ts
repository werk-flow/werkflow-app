import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { createServerClient } from '@supabase/ssr';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import { isRejectedSignInLink } from '@/lib/auth/identity-errors';
import {
  RECOVERY_CONFIRMATION_PATH,
  RECOVERY_LINK_COOKIE,
  RECOVERY_LINK_COOKIE_OPTIONS,
  RECOVERY_LINK_REDEMPTION,
  recoveryTokenHashSchema,
} from '@/lib/auth/recovery-link';
import { resolveSafeReturnPath } from '@/lib/auth/return-path';
import { CACHE_TAGS } from '@/lib/data/cached';
import {
  INVITE_MISMATCH_COOKIE,
  INVITE_MISMATCH_COOKIE_OPTIONS,
  readInviteRefusal,
} from '@/lib/invites/redemption-refusal';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { logError } from '@/lib/logging';
import { consumeRateLimit, inviteRedemptionChecks } from '@/lib/security/rate-limit';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/validation/uuid';

function isSessionPayload(value: unknown): value is { access_token: string; refresh_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string' &&
    'refresh_token' in value &&
    typeof value.refresh_token === 'string'
  );
}

function createCookieBoundSupabaseClient(req: NextRequest, res: NextResponse) {
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
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
      },
    },
  });
}

// Carries the session cookies the code exchange wrote on `res` over to another
// redirect, with their options, so the next page sees the signed-in user.
function withSessionCookies(redirect: NextResponse, res: NextResponse): NextResponse {
  for (const cookie of res.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

// Auth did not answer the link: it may still be valid, so the person sees a
// failure to retry, never the invalid-link page and never a signed-out state.
// A route handler cannot render a page, so it sends the browser to the
// prerendered /auth/unavailable screen; no session cookie travels with it.
function authUnavailableResponse(origin: string): NextResponse {
  return NextResponse.redirect(`${origin}/auth/unavailable`, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

// Redeems the invite of the account the code exchange just signed in. Only
// this path redeems in a GET: the exchange needs the PKCE verifier that this
// browser stored when it asked for the link, so a cross-site navigation cannot
// reach it. Redemption is limited per account and per client address first;
// a limiter that cannot decide redeems nothing.
async function redeemAfterCodeExchange(
  req: NextRequest,
  res: NextResponse,
  origin: string,
  inviteCode: string,
  userId: string,
): Promise<NextResponse> {
  const inviteError = (code: string): NextResponse =>
    withSessionCookies(NextResponse.redirect(`${origin}/invite-error?error=${code}`), res);
  const verdict = await consumeRateLimit(...inviteRedemptionChecks(userId, req.headers));
  if (verdict === 'limited') return inviteError('too_many_attempts');
  if (verdict === 'unavailable') return inviteError('redeem_failed');

  const { data, error } = await createSupabaseAdminClient().rpc('redeem_organization_invite_for_user', {
    p_invite_code: inviteCode,
    p_user_id: userId,
  });
  if (error) {
    logError('auth.callback: invite redemption failed', error);
    const refusal = readInviteRefusal(error);
    const redirect = inviteError(refusal ?? 'redeem_failed');
    if (refusal === 'email_mismatch') {
      redirect.cookies.set(INVITE_MISMATCH_COOKIE, inviteCode, INVITE_MISMATCH_COOKIE_OPTIONS);
    }
    return redirect;
  }
  const redemption = data[0];
  // The function returns a row or raises; an empty answer is a failure the person sees.
  if (!redemption) {
    logError('auth.callback: invite redemption returned no row', { code: 'empty_result' });
    return inviteError('redeem_failed');
  }

  const orgId = redemption.org_id;
  // The dashboard reads a cached member count; a route handler invalidates with revalidateTag.
  revalidateTag(CACHE_TAGS.memberCount(orgId), 'max');
  const confirmation = redemption.already_member ? 'already_member' : 'joined';
  const redirect = withSessionCookies(
    NextResponse.redirect(`${origin}/dashboard?${confirmation}=${orgId}`),
    res,
  );
  redirect.cookies.set({
    name: CURRENT_ORG_COOKIE,
    value: orgId,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: CURRENT_ORG_MAX_AGE,
    path: '/',
  });
  return redirect;
}

// Redeems the reset link the GET kept, after the person confirmed it on the
// reset page. The cookie goes once Auth decided; when Auth does not answer it
// stays, so the next click retries the link, which may still be valid.
async function redeemRecoveryLink(req: NextRequest): Promise<NextResponse> {
  const refused = (): NextResponse => {
    const response = NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    response.cookies.delete({ name: RECOVERY_LINK_COOKIE, path: RECOVERY_LINK_COOKIE_OPTIONS.path });
    return response;
  };
  const kept = recoveryTokenHashSchema.safeParse(req.cookies.get(RECOVERY_LINK_COOKIE)?.value);
  if (!kept.success) return refused();

  const unavailable = (): NextResponse =>
    NextResponse.json(
      { error: 'auth_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  const res = NextResponse.json({ success: true });
  const supabase = createCookieBoundSupabaseClient(req, res);
  let verification: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
  try {
    verification = await supabase.auth.verifyOtp({ token_hash: kept.data, type: 'recovery' });
  } catch (thrown) {
    logError('auth.callback: token hash verification threw', thrown);
    return unavailable();
  }
  if (verification.error) {
    logError('auth.callback: token hash verification failed', verification.error);
    if (!isRejectedSignInLink(verification.error)) {
      return unavailable();
    }
    return refused();
  }
  res.cookies.delete({ name: RECOVERY_LINK_COOKIE, path: RECOVERY_LINK_COOKIE_OPTIONS.path });
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  // Only same-origin paths may follow authentication (SI-003).
  const next = resolveSafeReturnPath(searchParams.get('next'), origin);
  const type = searchParams.get('type');
  // Invite codes are generated UUIDs; anything else is neither redeemed nor
  // echoed into a redirect (SI-026).
  const rawInviteCode = searchParams.get('invite_code');
  const inviteCode = rawInviteCode && isUuid(rawInviteCode) ? rawInviteCode : null;
  const redirectTo = type === 'recovery' ? '/reset-password' : next;

  // The reset email links its token hash here. The GET only keeps it for the
  // confirmation step, whose click redeems it through POST (recovery-link.ts).
  // Only the reset email carries a token hash.
  if (tokenHash) {
    const parsedHash = recoveryTokenHashSchema.safeParse(tokenHash);
    if (type !== 'recovery' || !parsedHash.success) {
      return NextResponse.redirect(`${origin}/forgot-password?error=invalid_token`, 303);
    }
    const res = NextResponse.redirect(`${origin}${RECOVERY_CONFIRMATION_PATH}`, {
      status: 303,
      headers: { 'Cache-Control': 'private, no-store' },
    });
    res.cookies.set(RECOVERY_LINK_COOKIE, parsedHash.data, RECOVERY_LINK_COOKIE_OPTIONS);
    return res;
  }

  if (code) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);
    const supabase = createCookieBoundSupabaseClient(req, res);
    let exchange: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>;
    try {
      exchange = await supabase.auth.exchangeCodeForSession(code);
    } catch (thrown) {
      logError('auth.callback: code exchange threw', thrown);
      return authUnavailableResponse(origin);
    }
    if (exchange.error) {
      logError('auth.callback: code exchange failed', exchange.error);
      if (!isRejectedSignInLink(exchange.error)) return authUnavailableResponse(origin);
      return NextResponse.redirect(`${origin}/forgot-password?error=invalid_code`);
    }
    if (inviteCode) return redeemAfterCodeExchange(req, res, origin, inviteCode, exchange.data.user.id);
    return res;
  }

  // An invite link without an auth code redeems nothing here: any site can
  // send a signed-in browser to this URL. The login page asks a signed-in
  // person to accept and redeems through the same-origin POST
  // /api/redeem-invite; a signed-out person signs in there first.
  if (inviteCode) {
    return NextResponse.redirect(`${origin}/login?invite_code=${inviteCode}`);
  }

  return NextResponse.redirect(`${origin}/`);
}

export async function POST(req: NextRequest) {
  // This handler writes auth cookies from a request body. Without an origin
  // check a cross-site form could log this browser into an attacker's account
  // (login CSRF, SI-013). Route handlers get no framework CSRF protection.
  const verdict = verifySameOriginJsonRequest(req);
  if (!verdict.allowed) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const parsedBody: unknown = await req.json().catch(() => null);
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const body: { event?: unknown; session?: unknown; redeem?: unknown } = parsedBody;
  if (body.redeem === RECOVERY_LINK_REDEMPTION) return redeemRecoveryLink(req);
  const event = typeof body.event === 'string' ? body.event : null;
  const session = body.session;

  const res = NextResponse.json({ success: true });

  const supabase = createCookieBoundSupabaseClient(req, res);

  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && isSessionPayload(session)) {
    await supabase.auth.setSession(session);
  }

  if (event === 'SIGNED_OUT') {
    // Local scope: this endpoint only syncs THIS browser's cookies with a
    // client-side event. The default global scope revoked every session the
    // user had on other devices whenever one stale tab emitted SIGNED_OUT.
    // Deliberate everywhere-sign-out stays with the explicit flows that own it.
    await supabase.auth.signOut({ scope: 'local' });
  }

  return res;
}
