'use client';

import { ConfirmActionDialog, type ConfirmActionStep } from '@/components/shared/confirm-action-dialog';
import type { DocumentConfirmDialogState } from './use-document-delete-actions';

type DocumentConfirmDialogProps = {
  confirmDialog: DocumentConfirmDialogState;
  onClose: () => void;
};

// The closed dialog's confirm, which nobody can reach.
const CLOSED: ConfirmActionStep = { onConfirm: () => Promise.resolve(null) };

/** The library's one destructive confirmation; the pending action lives in `confirmDialog`. */
export function DocumentConfirmDialog({ confirmDialog, onClose }: DocumentConfirmDialogProps) {
  return (
    <ConfirmActionDialog
      // The step first: whether it closes at once, and its confirm.
      {...(confirmDialog ?? CLOSED)}
      open={!!confirmDialog}
      onOpenChange={(open) => !open && onClose()}
      title={confirmDialog?.title}
      description={confirmDialog?.description}
      confirmLabel={confirmDialog?.confirmLabel ?? 'Bestätigen'}
      variant="destructive"
    />
  );
}
