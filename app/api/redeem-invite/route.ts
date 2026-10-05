import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revalidateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { consumeRateLimit, inviteRedemptionChecks } from '@/lib/security/rate-limit';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { isUuid } from '@/lib/validation/uuid';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // This handler sets the organization cookie from a request body; route
  // handlers get no framework CSRF protection (security.md, rule 2).
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

    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      if (userError) {
        logError('Invite redemption identity check failed:', userError);
      }
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

      // Check for specific error types
      if (redeemError.message?.includes('email_mismatch')) {
        // Extract the invited email from the error message (format: "email_mismatch::email@example.com").
        // The caller forwards it to /invite-error, which offers signing in
        // with the invited address; the invite code holder can already read
        // that address on the signup page.
        const emailMatch = redeemError.message.match(/email_mismatch::(.+)/);
        const invitedEmail = emailMatch ? emailMatch[1] : '';
        return NextResponse.json({ error: 'email_mismatch', invitedEmail }, { status: 400 });
      }
      if (redeemError.message?.includes('admin_mismatch')) {
        return NextResponse.json({ error: 'admin_mismatch' }, { status: 400 });
      }
      if (redeemError.message?.includes('invalid_invite')) {
        return NextResponse.json({ error: 'invalid_invite' }, { status: 400 });
      }
      if (redeemError.message?.includes('invite_expired')) {
        return NextResponse.json({ error: 'invite_expired' }, { status: 400 });
      }
      if (redeemError.message?.includes('invite_cancelled')) {
        return NextResponse.json({ error: 'invite_cancelled' }, { status: 400 });
      }
      if (redeemError.message?.includes('invite_already_used')) {
        return NextResponse.json({ error: 'invite_already_used' }, { status: 400 });
      }

      return NextResponse.json({ error: 'redeem_failed' }, { status: 500 });
    }

    const redemption = redeemResult?.[0];
    if (!redemption) {
      return NextResponse.json({ error: 'no_result' }, { status: 500 });
    }

    // Use the new column names from the updated RPC function
    const orgId = redemption.org_id;
    const alreadyMember = redemption.already_member;

    // Set the org cookie
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
      alreadyMember: alreadyMember || false,
    });
  } catch (error) {
    logError('Unexpected error in redeem-invite:', error);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
