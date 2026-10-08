'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { dispatchErrorMessage } from '@/lib/dispatch/types';

export function ReasonDialog({
  title,
  description,
  confirmLabel,
  minLength,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  minLength: number;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run: runConfirm, isPending: isSaving } = usePendingTask();

  const [reasonError, setReasonError] = useState<string | null>(null);

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < minLength) {
      setReasonError(`Bitte gib eine Begründung mit mindestens ${minLength} Zeichen an.`);
      document.getElementById('dispatch-reason-dialog')?.focus();
      return;
    }
    setReasonError(null);
    await runConfirm(async () => {
      try {
        const failure = await onConfirm(reason.trim());
        if (failure) setError(failure);
      } catch {
        setError(dispatchErrorMessage('unexpected_error'));
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleConfirm} noValidate className="space-y-4">
          <Field
            label="Begründung"
            htmlFor="dispatch-reason-dialog"
            required
            description={`Mindestens ${minLength} Zeichen.`}
            error={reasonError}
          >
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
