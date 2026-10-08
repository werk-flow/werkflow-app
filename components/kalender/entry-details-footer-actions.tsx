'use client';

import { Check, Pencil, Trash2, X } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { EntryDetailsActionId } from './entry-details-commands';
import { Spinner } from '@/components/ui/spinner';

type EntryDetailsReviewActionsProps = {
  isPending: boolean;
  isBusy: (id: EntryDetailsActionId) => boolean;
  onReview: (decision: 'approved' | 'rejected') => void;
};

export function EntryDetailsReviewActions({ isPending, isBusy, onReview }: EntryDetailsReviewActionsProps) {
  return (
    <div className="flex gap-2">
      <Button
        pending={isBusy('approve')}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onReview('approved')}
        disabled={isPending}
        className="gap-1"
      >
        <Check className="h-4 w-4" />
        Genehmigen
      </Button>
      <Button
        pending={isBusy('reject')}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onReview('rejected')}
        disabled={isPending}
        className="gap-1 text-destructive hover:text-destructive"
      >
        <X className="h-4 w-4" />
        Ablehnen
      </Button>
    </div>
  );
}

type EntryDetailsManageActionsProps = {
  isPending: boolean;
  isBusy: (id: EntryDetailsActionId) => boolean;
  hasPendingEntry: boolean;
  onStartEdit: () => void;
  onDelete: () => void;
};

export function EntryDetailsManageActions({
  isPending,
  isBusy,
  hasPendingEntry,
  onStartEdit,
  onDelete,
}: EntryDetailsManageActionsProps) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onStartEdit}
        disabled={isPending}
        className="gap-1"
      >
        <Pencil className="h-4 w-4" />
        Bearbeiten
      </Button>
      {!hasPendingEntry && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              className="gap-1 text-destructive hover:text-destructive"
            >
              {isBusy('delete') ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              Löschen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Arbeitsblock löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Diese Aktion kann nicht rückgängig gemacht werden. Alle zu diesem Arbeitsblock gehörenden
                Zeit-Einträge, inklusive eventueller Pausen, werden gelöscht.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} variant="destructive">
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
