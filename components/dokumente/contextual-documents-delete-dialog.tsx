'use client';

import type { ReactElement } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import type { OrganizationDocument } from '@/lib/documents/types';
import { getDeleteDescription } from './contextual-documents-context';

type ContextualDocumentsDeleteDialogProps = {
  /** The document to move to the trash; null keeps the dialog closed. */
  target: OrganizationDocument | null;
  onClose: () => void;
  /** Moves the document to the trash; its row shows the running step and a failure, so the confirmation closes at once. */
  onConfirm: (target: OrganizationDocument) => void;
};

/** Confirmation before a document leaves every linked record for the trash. */
export function ContextualDocumentsDeleteDialog({
  target,
  onClose,
  onConfirm,
}: ContextualDocumentsDeleteDialogProps): ReactElement {
  return (
    <ConfirmActionDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title="Datei in Papierkorb verschieben?"
      description={target ? getDeleteDescription(target) : ''}
      confirmLabel="In Papierkorb verschieben"
      variant="destructive"
      onConfirm={() => {
        if (target) onConfirm(target);
        return Promise.resolve(null);
      }}
    />
  );
}
