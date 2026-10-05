'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, XCircle, Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { cancelInvite } from '@/lib/invites/cancel-action';
import { deleteInvite } from '@/lib/invites/delete-action';
import { InviteCancelConfirmDialog, InviteDeleteConfirmDialog } from './invite-actions-menu-dialogs';
import { MANAGE_INVITE_MESSAGES } from './invite-messages';

interface InviteActionsMenuProps {
  inviteId: string;
  inviteEmail: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  isExpired: boolean; // Whether the invite has expired by date (even if status is 'pending')
  /**
   * Row-scoped busy state owned by the table (`useBusyIds`): the spinner
   * sits on this row and the other rows stay usable.
   */
  busy: {
    isBusy: boolean;
    run: <Result>(task: () => Promise<Result>) => Promise<Result>;
  };
  /** Resolves when refreshed props land, so the row stays marked until then. */
  waitForChange: () => Promise<void>;
}

export function InviteActionsMenu({
  inviteId,
  inviteEmail,
  status,
  isExpired,
  busy,
  waitForChange,
}: InviteActionsMenuProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoading = busy.isBusy;

  // Determine effective status (pending but expired = expired)
  const effectiveStatus = status === 'pending' && isExpired ? 'expired' : status;

  // Can only cancel if status is pending and not expired
  const canCancel = status === 'pending' && !isExpired;

  // Can only delete if not pending (cancelled, accepted, or expired)
  const canDelete = effectiveStatus !== 'pending';

  const handleCancel = async () => {
    setError(null);
    const result = await busy.run(() => cancelInvite(inviteId));

    if (result.success) {
      setShowCancelDialog(false);
      showBanner({
        variant: 'success',
        message: 'Die Einladung wurde storniert.',
      });
      router.refresh();
      void busy.run(waitForChange);
    } else {
      setError(
        describeFailure(result.error, MANAGE_INVITE_MESSAGES, 'Die Einladung konnte nicht storniert werden.'),
      );
    }
  };

  const handleDelete = async () => {
    setError(null);
    const result = await busy.run(() => deleteInvite(inviteId));

    if (result.success) {
      setShowDeleteDialog(false);
      showBanner({
        variant: 'success',
        message: 'Die Einladung wurde gelöscht.',
      });
      router.refresh();
      void busy.run(waitForChange);
    } else {
      setError(
        describeFailure(result.error, MANAGE_INVITE_MESSAGES, 'Die Einladung konnte nicht gelöscht werden.'),
      );
    }
  };

  // Don't show menu if no actions are available
  if (!canCancel && !canDelete) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isLoading}>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
            <span className="sr-only">Aktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canCancel && (
            <DropdownMenuItem
              onClick={() => setShowCancelDialog(true)}
              className="text-destructive focus:text-destructive"
            >
              <XCircle className="size-4 text-destructive" />
              Stornieren
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="size-4" />
              Löschen
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel Confirmation Dialog */}
      <InviteCancelConfirmDialog
        open={showCancelDialog}
        onOpenChange={(open) => {
          setShowCancelDialog(open);
          if (!open) setError(null);
        }}
        inviteEmail={inviteEmail}
        error={error}
        isLoading={isLoading}
        onConfirm={handleCancel}
      />

      {/* Delete Confirmation Dialog */}
      <InviteDeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setError(null);
        }}
        inviteEmail={inviteEmail}
        error={error}
        isLoading={isLoading}
        onConfirm={handleDelete}
      />
    </>
  );
}
