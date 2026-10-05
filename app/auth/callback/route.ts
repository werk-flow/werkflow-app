import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { createServerClient } from '@supabase/ssr';
import { type EmailOtpType, type PostgrestError } from '@supabase/supabase-js';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import { resolveSafeReturnPath } from '@/lib/auth/return-path';
import { CACHE_TAGS } from '@/lib/data/cached';
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
    typeof (value as { access_token?: unknown }).access_token === 'string' &&
    typeof (value as { refresh_token?: unknown }).refresh_token === 'string'
  );
}

// Redemption is limited per account and per client address before the RPC
// runs. A limit reached sends the caller to the invite error page; a limiter
// that cannot decide redeems nothing and is handled like a failed redemption,
// which sends the caller to the redeem_failed invite error page.
async function redeemInviteForUser(req: NextRequest, inviteCode: string, userId: string) {
  const verdict = await consumeRateLimit(...inviteRedemptionChecks(userId, req.headers));
  if (verdict !== 'allowed') return { verdict, data: null, error: null };
  const { data, error } = await createSupabaseAdminClient().rpc('redeem_organization_invite_for_user', {
    p_invite_code: inviteCode,
    p_user_id: userId,
  });
  return { verdict, data, error };
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
// redirect, with their options, so the invite error page sees the signed-in user.
function withSessionCookies(redirect: NextResponse, res: NextResponse): NextResponse {
  for (const cookie of res.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

// Maps the invite errors the RPC names to their error page; null for any other error.
function redirectForInviteRedemptionError(
  redeemError: PostgrestError,
  origin: string,
  inviteCode: string,
): NextResponse | null {
  if (redeemError.message?.includes('email_mismatch')) {
    // Extract the invited email from the error message (format: "email_mismatch::email@example.com")
    const emailMatch = redeemError.message.match(/email_mismatch::(.+)/);
    const invitedEmail = emailMatch?.[1] ?? '';
    return NextResponse.redirect(
      `${origin}/invite-error?error=email_mismatch&email=${encodeURIComponent(
        invitedEmail,
      )}&invite_code=${encodeURIComponent(inviteCode)}`,
    );
  }
  if (redeemError.message?.includes('admin_mismatch')) {
    return NextResponse.redirect(`${origin}/invite-error?error=admin_mismatch`);
  }
  if (redeemError.message?.includes('invalid_invite')) {
    return NextResponse.redirect(`${origin}/invite-error?error=invalid_invite`);
  }
  if (redeemError.message?.includes('invite_expired')) {
    return NextResponse.redirect(`${origin}/invite-error?error=invite_expired`);
  }
  if (redeemError.message?.includes('invite_cancelled')) {
    return NextResponse.redirect(`${origin}/invite-error?error=invite_cancelled`);
  }
  if (redeemError.message?.includes('invite_already_used')) {
    return NextResponse.redirect(`${origin}/invite-error?error=invite_already_used`);
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  // Only same-origin paths may follow authentication (SI-003).
  const next = resolveSafeReturnPath(searchParams.get('next'), origin);
  const type = searchParams.get('type') as EmailOtpType | null;
  // Invite codes are generated UUIDs; anything else is neither redeemed nor
  // echoed into a redirect (SI-026).
  const rawInviteCode = searchParams.get('invite_code');
  const inviteCode = rawInviteCode && isUuid(rawInviteCode) ? rawInviteCode : null;

  // Determine the redirect destination based on the auth type
  let redirectTo = next;
  if (type === 'recovery') {
    redirectTo = '/reset-password';
  }

  // Handle token_hash verification (for cross-browser password reset and email confirmation)
  // This approach works across browsers because verification happens server-side
  if (tokenHash && type) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);

    const supabase = createCookieBoundSupabaseClient(req, res);

    // Verify the OTP token_hash server-side
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (error) {
      logError('Token hash verification error:', error);
      // Redirect to reset-password with error for recovery, otherwise forgot-password
      if (type === 'recovery') {
        return NextResponse.redirect(
          `${origin}/reset-password?error=invalid_token&error_description=${encodeURIComponent(
            error.message,
          )}`,
        );
      }
      return NextResponse.redirect(`${origin}/forgot-password?error=invalid_token`);
    }

    // Successfully verified - session is now established in cookies
    return res;
  }

  if (code) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);

    const supabase = createCookieBoundSupabaseClient(req, res);

    // Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      logError('Code exchange error:', error);
      return NextResponse.redirect(`${origin}/forgot-password?error=invalid_code`);
    }

    // If there's an invite code, try to redeem it
    if (inviteCode) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.redirect(`${origin}/login?invite_code=${encodeURIComponent(inviteCode)}`);
      }

      const {
        verdict,
        data: redeemResult,
        error: redeemError,
      } = await redeemInviteForUser(req, inviteCode, user.id);

      if (verdict === 'limited') {
        return withSessionCookies(
          NextResponse.redirect(`${origin}/invite-error?error=too_many_attempts`),
          res,
        );
      }
      if (verdict === 'unavailable') {
        return withSessionCookies(NextResponse.redirect(`${origin}/invite-error?error=redeem_failed`), res);
      }
      const redemption = redeemResult?.[0];
      if (redeemError) {
        logError('Invite redemption error:', redeemError);

        // Handle specific error cases
        const knownErrorRedirect = redirectForInviteRedemptionError(redeemError, origin, inviteCode);
        return withSessionCookies(
          knownErrorRedirect ?? NextResponse.redirect(`${origin}/invite-error?error=redeem_failed`),
          res,
        );
      } else if (redemption) {
        // Successfully redeemed - set the org cookie and redirect to dashboard with success flag
        // Use the new column names from the updated RPC function
        const orgId = redemption.org_id;
        const alreadyMember = redemption.already_member;
        // The dashboard reads a cached member count; a route handler invalidates with revalidateTag.
        revalidateTag(CACHE_TAGS.memberCount(orgId), 'max');

        // Create the redirect response with the correct URL
        const redirectUrl = alreadyMember
          ? `${origin}/dashboard?already_member=${orgId}`
          : `${origin}/dashboard?joined=${orgId}`;
        const redirectRes = withSessionCookies(NextResponse.redirect(redirectUrl), res);

        // Set the org cookie on the redirect response
        redirectRes.cookies.set({
          name: CURRENT_ORG_COOKIE,
          value: orgId,
          httpOnly: true,
          sameSite: 'lax',
          maxAge: CURRENT_ORG_MAX_AGE,
          path: '/',
        });

        return redirectRes;
      }
    }

    return res;
  }

  // Handle invite code without auth code (existing user clicking invite link)
  if (inviteCode) {
    // Check if user is already logged in
    const res = NextResponse.redirect(`${origin}/dashboard`);

    const supabase = createCookieBoundSupabaseClient(req, res);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // User is logged in - redeem the invite
      const {
        verdict,
        data: redeemResult,
        error: redeemError,
      } = await redeemInviteForUser(req, inviteCode, user.id);

      if (verdict === 'limited') {
        return NextResponse.redirect(`${origin}/invite-error?error=too_many_attempts`);
      }
      if (verdict === 'unavailable') {
        return NextResponse.redirect(`${origin}/invite-error?error=redeem_failed`);
      }
      if (redeemError) {
        logError('Invite redemption error for existing user:', redeemError);

        const knownErrorRedirect = redirectForInviteRedemptionError(redeemError, origin, inviteCode);
        return knownErrorRedirect ?? NextResponse.redirect(`${origin}/invite-error?error=redeem_failed`);
      }

      const redemption = redeemResult?.[0];
      if (redemption) {
        // Use the new column names from the updated RPC function
        const orgId = redemption.org_id;
        const alreadyMember = redemption.already_member;
        // The dashboard reads a cached member count; a route handler invalidates with revalidateTag.
        revalidateTag(CACHE_TAGS.memberCount(orgId), 'max');

        // Create the redirect response with the correct URL
        const redirectUrl = alreadyMember
          ? `${origin}/dashboard?already_member=${orgId}`
          : `${origin}/dashboard?joined=${orgId}`;
        const redirectRes = NextResponse.redirect(redirectUrl);

        // Set the org cookie on the redirect response
        redirectRes.cookies.set({
          name: CURRENT_ORG_COOKIE,
          value: orgId,
          httpOnly: true,
          sameSite: 'lax',
          maxAge: CURRENT_ORG_MAX_AGE,
          path: '/',
        });

        return redirectRes;
      }

      return res;
    } else {
      // User is not logged in - redirect to login with invite code preserved
      return NextResponse.redirect(`${origin}/login?invite_code=${encodeURIComponent(inviteCode)}`);
    }
  }

  // If no code, redirect to home
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
  const body: { event?: unknown; session?: unknown } = parsedBody;
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
