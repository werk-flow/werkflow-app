'use server';

import { z } from '@/lib/zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { getAuthenticatedUser } from '@/lib/data/cached';
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

    // Sending trusts only the organization the cookie names, never a fallback.
    const cookieOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
    if (!cookieOrgId) {
      return { success: false, error: 'no_active_org' };
    }

    const auth = await resolveActionContextFor(cookieOrgId);
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) {
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
