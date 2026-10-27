'use server';

import { updateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAuthenticatedUser, CACHE_TAGS } from '@/lib/data/cached';
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
 * Deletes the current user's account, only while no membership row of any
 * lifecycle state exists: a suspended or ended member keeps the history their
 * membership anchors. The profile goes with the Auth user through its cascade,
 * in the same transaction, so a refused Auth deletion leaves it in place. The
 * database refuses the deletion of a member with recorded time as well.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const admin = createSupabaseAdminClient();

  const { count: membershipCount, error: membershipError } = await admin
    // tenant-scope: own-user-row — the signed-in user's own memberships in every organization, whatever their lifecycle state
    .from('organization_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (membershipError || membershipCount === null) {
    logError('deleteAccount: membership read failed', membershipError);
    return { success: false, error: 'delete_failed' };
  }
  if (membershipCount > 0) {
    return { success: false, error: 'has_memberships' };
  }

  // Pending invitations for this email stay: admins keep the full invitation
  // history of their organization, and open invites expire or are revoked.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    logError('deleteAccount: Auth user deletion failed', deleteError);
    return { success: false, error: 'delete_failed' };
  }

  return { success: true };
}
