'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAuthenticatedUser, getCachedMemberships, CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import type { ActionResult } from '@/lib/action-result';

/**
 * Invalidate the authenticated caller's cached profile.
 * Call this after upserting a profile from a client component. The identity is
 * taken from the verified session, never from the caller (SI-004).
 */
export async function invalidateProfileCache(): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) return;
  updateTag(CACHE_TAGS.profile(user.id));
}

export type DeleteAccountResult = ActionResult;

/**
 * Deletes the current user's account.
 * This action should only be available to users who:
 * - Are authenticated
 * - Have no organization memberships (orphan users)
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const memberships = await getCachedMemberships(user.id);
  if (memberships.length > 0) {
    return { success: false, error: 'has_memberships' };
  }

  const admin = createSupabaseAdminClient();

  const { error: profileDeleteError } = await admin.from('profiles').delete().eq('id', user.id);

  if (profileDeleteError) {
    logError('Error deleting profile:', profileDeleteError);
    // The profile may not exist; the auth user is deleted regardless.
  }

  // Pending invitations for this email stay: admins keep the full invitation
  // history of their organization, and open invites expire or are revoked.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    logError('Error deleting user:', deleteError);
    return { success: false, error: 'delete_failed' };
  }

  return { success: true };
}
