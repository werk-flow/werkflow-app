'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAuthenticatedUser, getCachedMemberships, CACHE_TAGS } from '@/lib/data/cached';

/**
 * Invalidate the cached profile for a user.
 * Call this after upserting a profile from a client component.
 */
export async function invalidateProfileCache(userId: string): Promise<void> {
  updateTag(CACHE_TAGS.profile(userId));
}

export type DeleteAccountResult =
  | { success: true }
  | { success: false; error: string };

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

  // Use admin client to delete the user
  const admin = createSupabaseAdminClient();

  // Delete the profile first (if it exists)
  const { error: profileDeleteError } = await admin
    .from('profiles')
    .delete()
    .eq('id', user.id);

  if (profileDeleteError) {
    console.error('Error deleting profile:', profileDeleteError);
    // Continue anyway - profile might not exist
  }

  // Note: We intentionally do NOT delete pending invitations for this user's email.
  // Admins should retain the full invitation history for their organizations.
  // Pending invites will expire naturally or can be manually revoked by admins.

  // Delete the user from auth.users
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    console.error('Error deleting user:', deleteError);
    return { success: false, error: 'delete_failed' };
  }

  return { success: true };
}
