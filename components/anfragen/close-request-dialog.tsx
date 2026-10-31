'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeFailure } from '@/lib/action-messages';
import { closeClientRequest } from '@/lib/requests/actions';
import {
  REQUEST_CLOSE_REASON_LABELS,
  REQUEST_CLOSE_REASON_ORDER,
  type RequestCloseReason,
} from '@/lib/requests/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu schließen.',
  request_not_found: 'Die Anfrage wurde nicht gefunden.',
  request_not_editable:
    'Diese Anfrage kann nicht mehr geschlossen werden (bereits umgewandelt oder geschlossen).',
  close_failed: 'Die Anfrage konnte nicht geschlossen werden. Möglicherweise wurde sie bereits umgewandelt.',
};

interface CloseRequestDialogProps {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved?: () => void;
}

interface CloseRequestFieldsProps {
  reason: RequestCloseReason;
  onReasonChange: (reason: RequestCloseReason) => void;
  note: string;
  onNoteChange: (note: string) => void;
  disabled: boolean;
}

/** The mandatory close reason and the optional note. */
function CloseRequestFields({
  reason,
  onReasonChange,
  note,
  onNoteChange,
  disabled,
}: CloseRequestFieldsProps) {
  return (
    <>
      <Field label="Grund" htmlFor="close-reason" required>
        <Select
          value={reason}
          onValueChange={(value) => {
            const nextReason = REQUEST_CLOSE_REASON_ORDER.find((candidate) => candidate === value);
            if (nextReason) onReasonChange(nextReason);
          }}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REQUEST_CLOSE_REASON_ORDER.map((value) => (
              <SelectItem key={value} value={value}>
                {REQUEST_CLOSE_REASON_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Notiz" htmlFor="close-note">
        <Textarea
          placeholder="Optionale Ergänzung, z. B. was stattdessen vereinbart wurde…"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

// Closing without work keeps the request and its history; only the reason is
// mandatory so the decision stays explainable later.
export function CloseRequestDialog({ requestId, open, onOpenChange, onSaved }: CloseRequestDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [reason, setReason] = useState<RequestCloseReason>('kein_bedarf');
  const [note, setNote] = useState('');
  const { run: runClose, isPending: isLoading } = useServerAction(closeClientRequest);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setReason('kein_bedarf');
      setNote('');
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await runClose(requestId, {
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (!result.success) {
        setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
        return;
      }
      handleOpenChange(false);
      onSaved?.();
      showBanner({ variant: 'success', message: 'Anfrage wurde geschlossen.' });
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isLoading}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Anfrage ohne Auftrag schließen</DialogTitle>
          <DialogDescription>
            Die Anfrage bleibt mit ihrer Historie erhalten und kann bei Bedarf wieder geöffnet werden.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <CloseRequestFields
              reason={reason}
              onReasonChange={setReason}
              note={note}
              onNoteChange={setNote}
              disabled={isLoading}
            />
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button pending={isLoading} type="submit" disabled={isLoading}>
              Anfrage schließen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
