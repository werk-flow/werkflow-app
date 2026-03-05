'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';
import { CACHE_TAGS } from '@/lib/data/cached';

export type DeleteOrgResult = {
  success: boolean;
  error?: string;
  nextOrgId?: string | null; // The next org to switch to (null if no remaining orgs)
};

/**
 * Delete an organization and all its associated data.
 * 
 * Rules:
 * - Only the admin can delete the organization
 * - The confirmation name must match the organization name exactly
 * - Deletes all organization_members for this org
 * - Deletes all organization_invites for this org
 * - Deletes the organization itself
 * - Users who lose their only org will be redirected to onboarding on next login
 */
export async function deleteOrganization(
  orgId: string,
  confirmationName: string
): Promise<DeleteOrgResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    // Verify the org exists and get its details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, admin_id')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'org_not_found' };
    }

    // Only admin can delete the organization
    if (org.admin_id !== user.id) {
      return { success: false, error: 'not_authorized' };
    }

    // Verify the confirmation name matches exactly
    if (confirmationName.trim() !== org.name) {
      return { success: false, error: 'name_mismatch' };
    }

    const admin = createSupabaseAdminClient();

    // Fetch all member user IDs before deletion so we can invalidate their caches
    const { data: allMembers } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId);
    const memberUserIds = (allMembers ?? []).map((m) => m.user_id);

    // Delete all organization members first (due to foreign key constraints)
    const { error: membersDeleteError } = await admin
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId);

    if (membersDeleteError) {
      console.error('Error deleting organization members:', membersDeleteError);
      return { success: false, error: 'delete_members_failed' };
    }

    // Delete all organization invites
    const { error: invitesDeleteError } = await admin
      .from('organization_invites')
      .delete()
      .eq('organization_id', orgId);

    if (invitesDeleteError) {
      console.error('Error deleting organization invites:', invitesDeleteError);
      return { success: false, error: 'delete_invites_failed' };
    }

    // Finally, delete the organization itself
    const { error: orgDeleteError } = await admin
      .from('organizations')
      .delete()
      .eq('id', orgId);

    if (orgDeleteError) {
      console.error('Error deleting organization:', orgDeleteError);
      return { success: false, error: 'delete_org_failed' };
    }

    // Get the user's remaining organizations using admin client
    // (to bypass RLS - the org we just deleted might affect RLS queries)
    const { data: remainingMemberships, error: remainingError } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id);

    if (remainingError) {
      console.error('Error fetching remaining memberships:', remainingError);
    }

    const remainingOrgs = remainingMemberships ?? [];
    const nextOrgId = remainingOrgs.length > 0 ? remainingOrgs[0].organization_id : null;

    // Update the org cookie with proper options (matching other actions)
    const cookieStore = await cookies();
    if (nextOrgId) {
      // Set to the next available org
      cookieStore.set(CURRENT_ORG_COOKIE, nextOrgId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: CURRENT_ORG_MAX_AGE,
        path: '/',
      });
    } else {
      // Clear the cookie if no orgs remain
      cookieStore.set(CURRENT_ORG_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }

    for (const uid of memberUserIds) {
      updateTag(CACHE_TAGS.memberships(uid));
    }
    updateTag(CACHE_TAGS.memberCount(orgId));

    return { success: true, nextOrgId };
  } catch (error) {
    console.error('Unexpected error in deleteOrganization:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

