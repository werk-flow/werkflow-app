'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { DocumentConfirmDialogState } from './use-document-delete-actions';

type DocumentConfirmDialogProps = {
  confirmDialog: DocumentConfirmDialogState;
  onClose: () => void;
};

/** The library's one destructive confirmation; the pending action lives in `confirmDialog`. */
export function DocumentConfirmDialog({ confirmDialog, onClose }: DocumentConfirmDialogProps) {
  return (
    <AlertDialog open={!!confirmDialog} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDialog?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              const onConfirm = confirmDialog?.onConfirm;
              onClose();
              onConfirm?.();
            }}
          >
            {confirmDialog?.confirmLabel ?? 'Bestätigen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
