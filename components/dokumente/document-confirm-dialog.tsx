'use client';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import type { DocumentConfirmDialogState } from './use-document-delete-actions';

type DocumentConfirmDialogProps = {
  confirmDialog: DocumentConfirmDialogState;
  onClose: () => void;
};

/** The library's one destructive confirmation; the pending action lives in `confirmDialog`. */
export function DocumentConfirmDialog({ confirmDialog, onClose }: DocumentConfirmDialogProps) {
  return (
    <ConfirmActionDialog
      open={!!confirmDialog}
      onOpenChange={(open) => !open && onClose()}
      title={confirmDialog?.title}
      description={confirmDialog?.description}
      confirmLabel={confirmDialog?.confirmLabel ?? 'Bestätigen'}
      variant="destructive"
      onConfirm={() => confirmDialog?.onConfirm() ?? Promise.resolve(null)}
    />
  );
}
