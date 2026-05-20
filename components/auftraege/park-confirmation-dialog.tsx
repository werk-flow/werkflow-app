'use client';

import { useState } from 'react';
import { Loader2, ParkingSquare } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface ParkConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: 'job' | 'project';
  title: string;
  identifier?: string;
  mode?: 'manual-park' | 'auto-park-date-removal';
  onConfirm: () => Promise<void>;
}

export function ParkConfirmationDialog({
  open,
  onOpenChange,
  variant,
  title,
  identifier,
  mode = 'manual-park',
  onConfirm,
}: ParkConfirmationDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const displayName = identifier ? `${identifier} – ${title}` : title;
  const isAutoParkDateRemoval = mode === 'auto-park-date-removal';

  const dialogTitle = isAutoParkDateRemoval
    ? 'Datum entfernen?'
    : variant === 'job'
      ? 'Auftrag parken?'
      : 'Projekt parken?';

  const description = isAutoParkDateRemoval
    ? (
      <>
        Wenn du das geplante Datum von{' '}
        <span className="font-medium text-foreground">{displayName}</span>{' '}
        entfernst, wird der Auftrag automatisch geparkt.
      </>
    )
    : variant === 'job'
      ? (
        <>
          Der Auftrag{' '}
          <span className="font-medium text-foreground">{displayName}</span>{' '}
          wird in den Parkplatz verschoben.
        </>
      )
      : (
        <>
          Das Projekt{' '}
          <span className="font-medium text-foreground">{displayName}</span>{' '}
          und alle zugehörigen Aufträge werden in den Parkplatz verschoben.
        </>
      );

  const warningText = isAutoParkDateRemoval
    ? 'Andere Metadaten wie Uhrzeit, Dauer und zugewiesene Mitarbeiter bleiben erhalten.'
    : variant === 'job'
      ? 'Das geplante Datum und die Uhrzeit werden entfernt.'
      : 'Alle geplanten Daten und Uhrzeiten der zugehörigen Aufträge werden entfernt.';

  const confirmLabel = isAutoParkDateRemoval ? 'Datum entfernen' : 'Parken';
  const loadingLabel = isAutoParkDateRemoval ? 'Wird gespeichert...' : 'Wird geparkt...';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ParkingSquare className="size-5 text-brand-purple" />
            {dialogTitle}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{description}</p>
              <p className="text-destructive/80 font-medium">
                {warningText}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              <>
                <ParkingSquare className="mr-2 size-4" />
                {confirmLabel}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
