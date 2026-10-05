'use server';

import { cookies } from 'next/headers';
import { z } from '@/lib/zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { createAndMailOrganizationInvite } from './send-invite';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

// Valid roles for invitations (admin cannot be assigned via invite)
const inviteRoleSchema = z.enum(['buero', 'employee']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export type SendInviteResult = {
  success: boolean;
  error?: string;
  // Present on success so the invitations list can confirm its draft row.
  inviteId?: string;
};

export async function sendOrgInvite(email: string, role: InviteRole = 'employee'): Promise<SendInviteResult> {
  try {
    const emailValidation = emailSchema.safeParse(email);
    if (!emailValidation.success) {
      return { success: false, error: 'invalid_email' };
    }
    const trimmedEmail = emailValidation.data;

    // Validate role - cannot assign admin role via invite
    const roleValidation = inviteRoleSchema.safeParse(role);
    if (!roleValidation.success) {
      return { success: false, error: 'invalid_role' };
    }
    const invitedRole = roleValidation.data;

    const [user, cookieStore] = await Promise.all([getAuthenticatedUser(), cookies()]);
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

    return await createAndMailOrganizationInvite({
      admin: createSupabaseAdminClient(),
      organizationId: orgId,
      inviterId: user.id,
      inviterFallbackName: user.email || 'Ein Administrator',
      email: trimmedEmail,
      role: invitedRole,
      employeeRecordId: null,
      replacedInviteId: null,
    });
  } catch (error) {
    logError('sendOrgInvite: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
