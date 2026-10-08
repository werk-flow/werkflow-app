import 'server-only';

import { randomUUID } from 'crypto';
import { headers } from 'next/headers';
import type { ActionFailure } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { getSiteUrl, getSupabaseSecretKey } from '@/lib/env/server';
import { logError } from '@/lib/logging';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { InviteRole } from './actions';

/** Refusals of create_organization_invite that reach the caller as their own code. */
const CREATE_INVITE_REFUSALS = [
  'invalid_role',
  'record_not_found',
  'already_has_login',
  'invite_already_pending',
];

export type OrganizationInviteSend = {
  admin: AdminClient;
  organizationId: string;
  inviterId: string;
  /** Shown as the inviter when the inviter has no profile name. */
  inviterFallbackName: string;
  email: string;
  role: InviteRole;
  /** The personnel record without login that the invite connects to, if any. */
  employeeRecordId: string | null;
  /** The record's current invite, which this send replaces. */
  replacedInviteId: string | null;
};

export type OrganizationInviteSendResult = { success: true; inviteId: string } | ActionFailure;

/**
 * Creates an organization invite and mails it. The caller has established
 * identity, the active organization and the manager role.
 *
 * Order: every database write happens in one transaction before the mail
 * (create_organization_invite), so a refused write never sends a mail. When
 * the mail fails, discard_unsent_organization_invite withdraws exactly what
 * this send wrote and gives a personnel record its replaced invite back, so
 * nothing stays behind that nobody received.
 */
export async function createAndMailOrganizationInvite(
  send: OrganizationInviteSend,
): Promise<OrganizationInviteSendResult> {
  const { admin, organizationId, email } = send;

  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .single();
  if (organizationError || !organization) {
    return { success: false, error: 'org_not_found' };
  }

  const { data: userCheckResult, error: userCheckError } = await admin.rpc('check_user_exists_by_email', {
    p_email: email,
  });
  // The answer picks the mail variant; a failed check sends nothing rather
  // than the sign-up variant to an address that may already have an account.
  if (userCheckError) {
    logError('createAndMailOrganizationInvite: check_user_exists_by_email failed', userCheckError);
    return { success: false, error: 'load_failed' };
  }
  const userCheck = Array.isArray(userCheckResult) ? userCheckResult[0] : userCheckResult;
  const isExistingUser = userCheck?.user_exists === true;
  const existingUserId = userCheck?.user_id || null;

  if (existingUserId) {
    const { data: existingMember, error: existingMemberError } = await loggedRead(
      'createAndMailOrganizationInvite: organization_members read failed',
      admin
        .from('organization_members')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('user_id', existingUserId)
        .maybeSingle(),
    );
    if (existingMemberError) return { success: false, error: 'load_failed' };
    if (existingMember) {
      return { success: false, error: 'already_member' };
    }
  }

  // An early answer that spends no rate-limit attempt; the function repeats
  // the check under its lock. The record's own invite is replaced, not a conflict.
  let pendingInviteQuery = admin
    .from('organization_invites')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', email)
    .eq('status', 'pending');
  if (send.replacedInviteId) pendingInviteQuery = pendingInviteQuery.neq('id', send.replacedInviteId);
  const { data: existingInvite, error: existingInviteError } = await loggedRead(
    'createAndMailOrganizationInvite: organization_invites read failed',
    pendingInviteQuery.maybeSingle(),
  );
  if (existingInviteError) return { success: false, error: 'load_failed' };
  if (existingInvite) {
    return { success: false, error: 'invite_already_pending' };
  }

  // Every invite sends a mail: limited per organization and per recipient
  // address. A limiter that cannot decide refuses (rate-limit.ts).
  const verdict = await consumeRateLimit(
    { action: 'invite_send_per_organization', subject: organizationId },
    { action: 'invite_send_per_recipient', subject: email },
  );
  if (verdict === 'limited') return { success: false, error: 'too_many_attempts' };
  if (verdict === 'unavailable') return { success: false, error: 'unexpected_error' };

  const inviteCode = randomUUID();
  const { data: created, error: createError } = await admin.rpc(
    'create_organization_invite',
    rpcArgs('create_organization_invite', {
      p_organization_id: organizationId,
      p_email: email,
      p_invite_code: inviteCode,
      p_invited_role: send.role,
      p_employee_record_id: send.employeeRecordId,
    }),
  );
  const [createdInvite] = created ?? [];
  if (createError || !createdInvite) {
    const refusal = CREATE_INVITE_REFUSALS.find((code) => createError?.message.includes(code));
    if (refusal) return { success: false, error: refusal };
    logError('createAndMailOrganizationInvite: create_organization_invite failed', createError);
    return { success: false, error: 'insert_failed' };
  }

  const headersList = await headers();
  const origin = getSiteUrl() || headersList.get('origin') || '';
  const { data: inviterProfile } = await loggedRead(
    'createAndMailOrganizationInvite: profiles read failed',
    admin.from('profiles').select('first_name, last_name').eq('id', send.inviterId).single(),
    true,
  );
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(' ') ||
    send.inviterFallbackName;

  // Existing accounts redeem through auth/callback; new ones sign up with the
  // address prefilled.
  const inviteUrl = isExistingUser
    ? `${origin}/auth/callback?invite_code=${inviteCode}`
    : `${origin}/signup?email=${encodeURIComponent(email)}&invite_code=${inviteCode}`;

  const supabaseSecretKey = getSupabaseSecretKey();
  const { error: emailError } = await admin.functions.invoke('send-invite-email', {
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
    },
    body: {
      to: email,
      inviterName,
      organizationName: organization.name,
      inviteUrl,
      isExistingUser,
    },
  });

  if (emailError) {
    logError('createAndMailOrganizationInvite: send-invite-email failed', emailError);
    const { error: discardError } = await admin.rpc(
      'discard_unsent_organization_invite',
      rpcArgs('discard_unsent_organization_invite', {
        p_organization_id: organizationId,
        p_invite_id: createdInvite.invite_id,
        p_replaced_invite_id: createdInvite.replaced_invite_id,
      }),
    );
    if (discardError) {
      // The unsent invite stays pending; the office can cancel it or send again.
      logError('createAndMailOrganizationInvite: discard_unsent_organization_invite failed', discardError);
    }
    return { success: false, error: 'email_send_failed' };
  }

  return { success: true, inviteId: createdInvite.invite_id };
}
