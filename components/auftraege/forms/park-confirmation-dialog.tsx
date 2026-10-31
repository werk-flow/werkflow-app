'use client';

import { useState } from 'react';
import { ParkingSquare } from 'lucide-react';
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
import { useServerAction } from '@/hooks/use-server-action';

const CONFIRM_FAILED_MESSAGE = 'Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.';

interface ParkConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: 'job' | 'project';
  title: string;
  identifier?: string | undefined;
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
  const { run: runConfirm, isPending: isLoading } = useServerAction(onConfirm);
  const [error, setError] = useState<string | null>(null);

  // A rejected confirm keeps the dialog open with the failure visible; the
  // parent's own result handling (a form error under this dialog) closes it
  // normally because that path resolves instead of throwing.
  const handleConfirm = async () => {
    setError(null);
    try {
      await runConfirm();
    } catch {
      setError(CONFIRM_FAILED_MESSAGE);
      return;
    }
    onOpenChange(false);
  };

  const displayName = identifier ? `${identifier} – ${title}` : title;
  const { dialogTitle, description, warningText, confirmLabel, loadingLabel } = parkConfirmationCopy(
    variant,
    mode,
    displayName,
  );

  return (
    <AlertDialog
      open={open}
      pending={isLoading}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ParkingSquare className="size-5 text-brand-purple" />
            {dialogTitle}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{description}</p>
              <p className="font-medium text-destructive">{warningText}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open (with its loading state) until the async
              // confirm resolves; handleConfirm closes it on success and
              // surfaces every failure itself, so nothing is discarded here.
              event.preventDefault();
              void handleConfirm();
            }}
            pending={isLoading}
          >
            <ParkingSquare className="mr-2 size-4" />
            {isLoading ? loadingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The title, sentences and button labels of the dialog for its variant and mode. */
function parkConfirmationCopy(
  variant: ParkConfirmationDialogProps['variant'],
  mode: NonNullable<ParkConfirmationDialogProps['mode']>,
  displayName: string,
) {
  const isAutoParkDateRemoval = mode === 'auto-park-date-removal';

  const dialogTitle = isAutoParkDateRemoval
    ? 'Datum entfernen?'
    : variant === 'job'
      ? 'Auftrag parken?'
      : 'Projekt parken?';

  const description = isAutoParkDateRemoval ? (
    <>
      Wenn du das geplante Datum von <span className="font-medium text-foreground">{displayName}</span>{' '}
      entfernst, bleibt der Arbeitsstand unverändert.
    </>
  ) : variant === 'job' ? (
    <>
      Der Auftrag <span className="font-medium text-foreground">{displayName}</span> wird in den Parkplatz
      verschoben.
    </>
  ) : (
    <>
      Das Projekt <span className="font-medium text-foreground">{displayName}</span> und alle zugehörigen
      Aufträge werden in den Parkplatz verschoben.
    </>
  );

  const warningText = isAutoParkDateRemoval
    ? 'Parkplatz, Uhrzeit, Dauer und zugewiesene Mitarbeiter bleiben ebenfalls unverändert.'
    : variant === 'job'
      ? 'Das geplante Datum und die Uhrzeit werden entfernt.'
      : 'Alle geplanten Daten und Uhrzeiten der zugehörigen Aufträge werden entfernt.';

  const confirmLabel = isAutoParkDateRemoval ? 'Datum entfernen' : 'Parken';
  const loadingLabel = isAutoParkDateRemoval ? 'Wird gespeichert…' : 'Wird geparkt…';

  return { dialogTitle, description, warningText, confirmLabel, loadingLabel };
}
