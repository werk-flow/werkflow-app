'use client';

import type { ReactElement } from 'react';

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
import type { OrganizationDocument } from '@/lib/documents/types';
import { getDeleteDescription } from './contextual-documents-context';

type ContextualDocumentsDeleteDialogProps = {
  /** The document to move to the trash; null keeps the dialog closed. */
  target: OrganizationDocument | null;
  onClose: () => void;
  onConfirm: (target: OrganizationDocument) => void;
};

/** Confirmation before a document leaves every linked record for the trash. */
export function ContextualDocumentsDeleteDialog({
  target,
  onClose,
  onConfirm,
}: ContextualDocumentsDeleteDialogProps): ReactElement {
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Datei in Papierkorb verschieben?</AlertDialogTitle>
          <AlertDialogDescription>{target ? getDeleteDescription(target) : ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onClose();
              if (target) onConfirm(target);
            }}
          >
            In Papierkorb verschieben
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
