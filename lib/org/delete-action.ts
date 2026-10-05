'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE, resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';

export type DeleteOrgResult = {
  success: boolean;
  error?: string;
  nextOrgId?: string | null; // The next org to switch to (null if no remaining orgs)
};

const confirmationNameSchema = z.string();

/**
 * Delete an organization and all its associated data.
 *
 * Rules:
 * - Only the admin can delete the organization
 * - The confirmation name must match the organization name exactly
 * - Deletes the organization row; the foreign key cascade removes its
 *   memberships, invites and all other organization data in the same statement
 * - Users who lose their only org will be redirected to onboarding on next login
 */
export async function deleteOrganization(confirmationName: string): Promise<DeleteOrgResult> {
  const parsedConfirmation = confirmationNameSchema.safeParse(confirmationName);
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const cookieStore = await cookies();
    const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

    if (!activeOrgId) {
      return { success: false, error: 'org_not_found' };
    }

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id, name, admin_id')
      .eq('id', activeOrgId)
      .single();

    if (orgError || !org) {
      return { success: false, error: 'org_not_found' };
    }

    // Only admin can delete the organization
    if (org.admin_id !== user.id) {
      return { success: false, error: 'not_authorized' };
    }

    // Verify the confirmation name matches exactly
    if (!parsedConfirmation.success || parsedConfirmation.data.trim() !== org.name) {
      return { success: false, error: 'name_mismatch' };
    }

    // One statement: the cascade removes the memberships, invites and every
    // other organization row with it, or nothing. Deleting the memberships
    // first was refused by the owner-membership guard.
    const { error: orgDeleteError } = await admin.from('organizations').delete().eq('id', activeOrgId);

    if (orgDeleteError) {
      logError('deleteOrganization: organization delete failed', orgDeleteError);
      return { success: false, error: 'delete_org_failed' };
    }

    // Get the user's remaining organizations using admin client
    // (to bypass RLS - the org we just deleted might affect RLS queries)
    const { data: remainingMemberships, error: remainingError } = await admin
      // tenant-scope: cross-organization-by-design — the signed-in user's remaining memberships pick the next active organization
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id);

    if (remainingError) {
      logError('deleteOrganization: remaining memberships read failed', remainingError);
    }

    const remainingOrgs = remainingMemberships ?? [];
    const nextOrgId = remainingOrgs[0]?.organization_id ?? null;

    // Update the org cookie with proper options (matching other actions)
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

    updateTag(CACHE_TAGS.memberCount(activeOrgId));

    return { success: true, nextOrgId };
  } catch (error) {
    logError('deleteOrganization: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}
