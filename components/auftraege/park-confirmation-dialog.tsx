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
  onConfirm: () => Promise<void>;
}

export function ParkConfirmationDialog({
  open,
  onOpenChange,
  variant,
  title,
  identifier,
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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ParkingSquare className="size-5 text-brand-purple" />
            {variant === 'job' ? 'Auftrag parken?' : 'Projekt parken?'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {variant === 'job' ? (
                  <>
                    Der Auftrag{' '}
                    <span className="font-medium text-foreground">{displayName}</span>{' '}
                    wird in den Parkplatz verschoben.
                  </>
                ) : (
                  <>
                    Das Projekt{' '}
                    <span className="font-medium text-foreground">{displayName}</span>{' '}
                    und alle zugehörigen Aufträge werden in den Parkplatz verschoben.
                  </>
                )}
              </p>
              <p className="text-destructive/80 font-medium">
                {variant === 'job'
                  ? 'Das geplante Datum und die Uhrzeit werden entfernt.'
                  : 'Alle geplanten Daten und Uhrzeiten der zugehörigen Aufträge werden entfernt.'}
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
                Wird geparkt...
              </>
            ) : (
              <>
                <ParkingSquare className="mr-2 size-4" />
                Parken
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
