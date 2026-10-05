'use server';

import type { ActionResult } from '@/lib/action-result';
import { requireManagedInvite } from '@/lib/invites/managed-invite';
import { uuidSchema } from '@/lib/validation/uuid';
import { logError } from '@/lib/logging';

export type CancelInviteResult = ActionResult;

export async function cancelInvite(inviteIdInput: string): Promise<CancelInviteResult> {
  const parsedInviteId = uuidSchema.safeParse(inviteIdInput);
  if (!parsedInviteId.success) return { success: false, error: 'invalid_input' };
  try {
    const managed = await requireManagedInvite(parsedInviteId.data);
    if (!managed.success) return managed;
    const { admin, orgId, inviteId, status } = managed.invite;

    // Only a pending invite can be cancelled; each other status has its own code.
    if (status === 'cancelled') return { success: false, error: 'already_cancelled' };
    if (status === 'accepted') return { success: false, error: 'already_accepted' };
    if (status === 'expired') return { success: false, error: 'already_expired' };
    if (status !== 'pending') return { success: false, error: 'invite_not_pending' };

    // The status filter keeps an invite accepted after the read from turning cancelled.
    const { data: cancelledRows, error: updateErr } = await admin
      .from('organization_invites')
      .update({ status: 'cancelled' })
      .eq('id', inviteId)
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .select('id');

    if (updateErr) {
      logError('Error cancelling invite:', { code: updateErr.code });
      return { success: false, error: 'cancel_failed' };
    }
    if (cancelledRows.length !== 1) return { success: false, error: 'invite_not_pending' };

    return { success: true };
  } catch (error) {
    logError('Unexpected error cancelling invite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
