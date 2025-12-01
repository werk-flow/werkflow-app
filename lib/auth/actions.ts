'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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
  const supabase = await createSupabaseServerClient();

  // Get the current user
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: 'not_authenticated' };
  }

  // Check if user has any organization memberships
  const { data: memberships, error: membershipError } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (membershipError) {
    console.error('Error checking memberships:', membershipError);
    return { success: false, error: 'database_error' };
  }

  // Don't allow deletion if user is a member of any organization
  if (memberships && memberships.length > 0) {
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
