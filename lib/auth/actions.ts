'use server';

import { updateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAuthenticatedUser, getCachedMemberships, CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import type { ActionResult } from '@/lib/action-result';
import { RESET_ADDRESS_COOKIE, RESET_ADDRESS_COOKIE_OPTIONS } from '@/lib/auth/address-cookies';

/**
 * Invalidate the authenticated caller's cached profile.
 * Call this after upserting a profile from a client component. The identity is
 * taken from the verified session, never from the caller (SI-004).
 */
export async function invalidateProfileCache(): Promise<ActionResult<object, 'not_authenticated'>> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  updateTag(CACHE_TAGS.profile(user.id));
  return { success: true };
}

/**
 * Leaves the caller's own address for the reset form, which the password
 * change in the settings opens after it has signed out everywhere. The address
 * comes from the verified session, never from the caller, and travels in an
 * httpOnly cookie scoped to the form instead of its URL.
 */
export async function rememberPasswordResetAddress(): Promise<
  ActionResult<object, 'not_authenticated' | 'no_address'>
> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  if (!user.email) return { success: false, error: 'no_address' };
  (await cookies()).set(RESET_ADDRESS_COOKIE, user.email, RESET_ADDRESS_COOKIE_OPTIONS);
  return { success: true };
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
