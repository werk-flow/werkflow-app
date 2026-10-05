'use server';

import type { ActionResult } from '@/lib/action-result';
import { requireManagedInvite } from '@/lib/invites/managed-invite';
import { uuidSchema } from '@/lib/validation/uuid';
import { logError } from '@/lib/logging';

export type DeleteInviteResult = ActionResult;

export async function deleteInvite(inviteIdInput: string): Promise<DeleteInviteResult> {
  const parsedInviteId = uuidSchema.safeParse(inviteIdInput);
  if (!parsedInviteId.success) return { success: false, error: 'invalid_input' };
  try {
    const managed = await requireManagedInvite(parsedInviteId.data);
    if (!managed.success) return managed;
    const { admin, orgId, inviteId, status } = managed.invite;

    // Only a cancelled, accepted or expired invite can be deleted.
    if (status === 'pending') return { success: false, error: 'must_cancel_first' };

    const { error: deleteErr } = await admin
      .from('organization_invites')
      .delete()
      .eq('id', inviteId)
      .eq('organization_id', orgId);

    if (deleteErr) {
      logError('Error deleting invite:', { code: deleteErr.code });
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    logError('Unexpected error deleting invite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
