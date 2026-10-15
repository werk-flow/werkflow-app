import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revalidateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isRejectedIdentity } from '@/lib/auth/identity-errors';
import {
  INVITE_MISMATCH_COOKIE,
  INVITE_MISMATCH_COOKIE_OPTIONS,
  readInviteRefusal,
} from '@/lib/invites/redemption-refusal';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { consumeRateLimit, inviteRedemptionChecks } from '@/lib/security/rate-limit';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { isUuid } from '@/lib/validation/uuid';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // This handler sets the organization cookie from a request body; route
  // handlers get no framework CSRF protection
  // (docs/technical/security.md#add-a-server-action-or-route-handler).
  if (!verifySameOriginJsonRequest(req).allowed) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  try {
    const body: unknown = await req.json().catch(() => null);
    const inviteCode =
      typeof body === 'object' && body !== null && 'inviteCode' in body ? body.inviteCode : null;

    if (typeof inviteCode !== 'string' || !isUuid(inviteCode)) {
      return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    // An identity check that cannot complete is a retryable failure, never
    // "not authenticated": the caller may well be signed in.
    if (userError && !isRejectedIdentity(userError)) {
      logError('Invite redemption identity check unavailable:', userError);
      return NextResponse.json({ error: 'auth_unavailable' }, { status: 503 });
    }
    if (!user) {
      return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    // Redemption is limited per account and per client address. A limiter
    // that cannot decide refuses with a retryable failure (rate-limit.ts).
    const verdict = await consumeRateLimit(...inviteRedemptionChecks(user.id, req.headers));
    if (verdict === 'limited') {
      return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 });
    }
    if (verdict === 'unavailable') {
      return NextResponse.json({ error: 'unexpected_error' }, { status: 503 });
    }

    const { data: redeemResult, error: redeemError } = await createSupabaseAdminClient().rpc(
      'redeem_organization_invite_for_user',
      {
        p_invite_code: inviteCode,
        p_user_id: user.id,
      },
    );

    if (redeemError) {
      logError('RPC error redeeming invite:', redeemError);
      const refusal = readInviteRefusal(redeemError);
      if (refusal === 'email_mismatch') {
        // The invite error page offers signing in again with this invite; the
        // code goes there in a short-lived cookie, never in its URL.
        const cookieStore = await cookies();
        cookieStore.set(INVITE_MISMATCH_COOKIE, inviteCode, INVITE_MISMATCH_COOKIE_OPTIONS);
      }
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
      return NextResponse.json({ error: 'redeem_failed' }, { status: 500 });
    }

    const redemption = redeemResult[0];
    if (!redemption) {
      return NextResponse.json({ error: 'no_result' }, { status: 500 });
    }

    const orgId = redemption.org_id;
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/',
    });

    // Route Handlers must use revalidateTag; updateTag is Server-Action-only
    // and threw "updateTag can only be called from within a Server Action" here.
    revalidateTag(CACHE_TAGS.memberCount(orgId), 'max');

    return NextResponse.json({
      success: true,
      organizationId: orgId,
      organizationName: redemption.org_name,
      alreadyMember: redemption.already_member || false,
    });
  } catch (error) {
    logError('Unexpected error in redeem-invite:', error);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
