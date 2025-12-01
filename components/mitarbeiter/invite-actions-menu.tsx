'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, XCircle, Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { cancelInvite } from '@/lib/invites/cancel-action';
import { deleteInvite } from '@/lib/invites/delete-action';

interface InviteActionsMenuProps {
  inviteId: string;
  inviteEmail: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  isExpired: boolean; // Whether the invite has expired by date (even if status is 'pending')
}

export function InviteActionsMenu({
  inviteId,
  inviteEmail,
  status,
  isExpired
}: InviteActionsMenuProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine effective status (pending but expired = expired)
  const effectiveStatus =
    status === 'pending' && isExpired ? 'expired' : status;

  // Can only cancel if status is pending and not expired
  const canCancel = status === 'pending' && !isExpired;

  // Can only delete if not pending (cancelled, accepted, or expired)
  const canDelete = effectiveStatus !== 'pending';

  const handleCancel = async () => {
    setIsLoading(true);
    setError(null);

    const result = await cancelInvite(inviteId);

    if (result.success) {
      setShowCancelDialog(false);
      router.refresh();
    } else {
      setError(result.error || 'Fehler beim Stornieren der Einladung.');
    }

    setIsLoading(false);
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);

    const result = await deleteInvite(inviteId);

    if (result.success) {
      setShowDeleteDialog(false);
      router.refresh();
    } else {
      setError(result.error || 'Fehler beim Löschen der Einladung.');
    }

    setIsLoading(false);
  };

  // Don't show menu if no actions are available
  if (!canCancel && !canDelete) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
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
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="size-4" />
              Löschen
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einladung stornieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du die Einladung für{' '}
              <span className="font-medium">{inviteEmail}</span> stornieren
              möchtest? Der Einladungslink wird ungültig und kann nicht mehr
              verwendet werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird storniert...
                </>
              ) : (
                'Stornieren'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einladung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du die Einladung für{' '}
              <span className="font-medium">{inviteEmail}</span> endgültig
              löschen möchtest? Diese Aktion kann nicht rückgängig gemacht
              werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird gelöscht...
                </>
              ) : (
                'Löschen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
