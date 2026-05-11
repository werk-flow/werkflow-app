import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { CACHE_TAGS } from '@/lib/data/cached';

export async function POST(req: NextRequest) {
  try {
    const { inviteCode } = await req.json();

    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json(
        { error: 'invalid_invite_code' },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Get the current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('User not authenticated:', userError);
      return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const { data: redeemResult, error: redeemError } =
      await createSupabaseAdminClient().rpc(
        'redeem_organization_invite_for_user',
        {
          p_invite_code: inviteCode,
          p_user_id: user.id
        }
      );

    if (redeemError) {
      console.error('RPC error redeeming invite:', redeemError);

      // Check for specific error types
      if (redeemError.message?.includes('email_mismatch')) {
        // Extract the invited email from the error message (format: "email_mismatch::email@example.com")
        const emailMatch = redeemError.message.match(/email_mismatch::(.+)/);
        const invitedEmail = emailMatch ? emailMatch[1] : '';
        return NextResponse.json(
          { error: 'email_mismatch', invitedEmail },
          { status: 400 }
        );
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
        return NextResponse.json(
          { error: 'invite_cancelled' },
          { status: 400 }
        );
      }
      if (redeemError.message?.includes('invite_already_used')) {
        return NextResponse.json(
          { error: 'invite_already_used' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'redeem_failed', details: redeemError.message },
        { status: 500 }
      );
    }

    if (!redeemResult || redeemResult.length === 0) {
      return NextResponse.json({ error: 'no_result' }, { status: 500 });
    }

    // Use the new column names from the updated RPC function
    const orgId = redeemResult[0].org_id;
    const alreadyMember = redeemResult[0].already_member;

    // Set the org cookie
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/'
    });

    updateTag(CACHE_TAGS.memberships(user.id));
    updateTag(CACHE_TAGS.memberCount(orgId));

    return NextResponse.json({
      success: true,
      organizationId: orgId,
      organizationName: redeemResult[0].org_name,
      alreadyMember: alreadyMember || false
    });
  } catch (error) {
    console.error('Unexpected error in redeem-invite:', error);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
