'use server';

import { cookies, headers } from 'next/headers';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';

// Email validation schema
const emailSchema = z.string().email();

// Valid roles for invitations (admin cannot be assigned via invite)
export type InviteRole = 'buero' | 'employee';
const VALID_INVITE_ROLES: InviteRole[] = ['buero', 'employee'];

export type SendInviteResult = {
  success: boolean;
  error?: string;
};

export async function sendOrgInvite(
  email: string,
  role: InviteRole = 'employee'
): Promise<SendInviteResult> {
  try {
    // Validate email format
    const trimmedEmail = email.trim().toLowerCase();
    const emailValidation = emailSchema.safeParse(trimmedEmail);
    if (!emailValidation.success) {
      return { success: false, error: 'invalid_email' };
    }

    // Validate role - cannot assign admin role via invite
    if (!VALID_INVITE_ROLES.includes(role)) {
      return { success: false, error: 'invalid_role' };
    }

    const [user, cookieStore] = await Promise.all([
      getAuthenticatedUser(),
      cookies()
    ]);
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const memberships = await getCachedMemberships(user.id);
    const callerMembership = memberships.find((m) => m.orgId === orgId);

    if (!callerMembership) {
      return { success: false, error: 'not_a_member' };
    }

    const callerRole = callerMembership.role;

    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('id, admin_id, name')
      .eq('id', orgId)
      .single();

    if (orgErr || !org) {
      return { success: false, error: 'org_not_found' };
    }

    const { data: userCheckResult, error: userCheckError } = await admin.rpc(
      'check_user_exists_by_email',
      { p_email: trimmedEmail }
    );

    if (userCheckError) {
      console.error('Error checking if user exists:', userCheckError);
    }

    // The RPC returns an array, get the first result
    const userCheck = Array.isArray(userCheckResult)
      ? userCheckResult[0]
      : userCheckResult;
    const isExistingUser = userCheck?.user_exists === true;
    const existingUserId = userCheck?.user_id || null;

    // If user exists, check if they're already a member of the CURRENT org we're inviting to
    // Use admin client to bypass RLS (admin might not be member of all orgs)
    if (existingUserId) {
      const { data: existingMember } = await admin
        .from('organization_members')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', existingUserId)
        .maybeSingle();

      if (existingMember) {
        return { success: false, error: 'already_member' };
      }
    }

    // Check if there's already a pending invite for this email in this org
    // Use admin client since only admins can see invites via RLS
    const { data: existingInvite } = await admin
      .from('organization_invites')
      .select('id')
      .eq('organization_id', orgId)
      .eq('email', trimmedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return { success: false, error: 'invite_already_pending' };
    }

    // Generate unique invite code
    const inviteCode = randomUUID();

    // Insert invite record using admin client (no INSERT policy for invites)
    // Include the invited_role so the user receives the correct role when accepting
    const { error: insErr } = await admin.from('organization_invites').insert({
      organization_id: orgId,
      email: trimmedEmail,
      invite_code: inviteCode,
      invited_role: role
    });

    if (insErr) {
      console.error('Error inserting invite:', insErr);
      return { success: false, error: 'insert_failed' };
    }

    // Build redirect URL based on whether user exists
    const headersList = await headers();
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL || headersList.get('origin') || '';

    // Get inviter's profile for the email
    const { data: inviterProfile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single();

    const inviterName = inviterProfile
      ? `${inviterProfile.first_name} ${inviterProfile.last_name}`.trim()
      : user.email || 'Ein Administrator';

    // Build the invite URL based on whether user exists
    // For existing users: link to auth/callback which will redeem the invite
    // For new users: link to signup page with email prefilled
    const inviteUrl = isExistingUser
      ? `${origin}/auth/callback?invite_code=${inviteCode}`
      : `${origin}/signup?email=${encodeURIComponent(
          trimmedEmail
        )}&invite_code=${inviteCode}`;

    // Use edge function to send invite email for both existing and new users
    // This avoids the issue with inviteUserByEmail which fails for existing users
    const { error: emailError } = await admin.functions.invoke(
      'send-invite-email',
      {
        body: {
          to: trimmedEmail,
          inviterName,
          organizationName: org.name,
          inviteUrl,
          isExistingUser
        }
      }
    );

    if (emailError) {
      console.error('Error sending invite email:', emailError);
      // Rollback the invite record using admin client
      await admin
        .from('organization_invites')
        .delete()
        .eq('invite_code', inviteCode);
      return { success: false, error: 'email_send_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in sendOrgInvite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
