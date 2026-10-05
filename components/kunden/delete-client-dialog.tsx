'use client';

import { Loader2 } from 'lucide-react';

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
import { ErrorText } from '@/components/ui/error-text';

interface DeleteClientDialogProps {
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDeleting: boolean;
  deleteError: string | null;
  onConfirm: () => Promise<void>;
}

export function DeleteClientDialog({
  clientName,
  open,
  onOpenChange,
  isDeleting,
  deleteError,
  onConfirm,
}: DeleteClientDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={isDeleting}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Bist du sicher, dass du <span className="font-medium">{clientName}</span> löschen möchtest?
            Bestehende Aufträge und Projekte verlieren die Zuordnung zu diesem Kunden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{deleteError}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Wird gelöscht…
              </>
            ) : (
              'Löschen'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
