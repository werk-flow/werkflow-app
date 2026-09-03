'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  close_failed:
    'Die Anfrage konnte nicht geschlossen werden. Möglicherweise wurde sie bereits umgewandelt.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

interface CloseRequestDialogProps {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved?: () => void;
}

// Closing without work keeps the request and its history; only the reason is
// mandatory so the decision stays explainable later.
export function CloseRequestDialog({
  requestId,
  open,
  onOpenChange,
  onSaved,
}: CloseRequestDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [reason, setReason] = useState<RequestCloseReason>('kein_bedarf');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
    setIsLoading(true);
    try {
      const result = await closeClientRequest(requestId, {
        reason,
        note: note.trim() || undefined,
      });
      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] || 'Unbekannter Fehler');
        return;
      }
      handleOpenChange(false);
      onSaved?.();
      showBanner({ variant: 'success', message: 'Anfrage wurde geschlossen.' });
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Anfrage ohne Auftrag schließen</DialogTitle>
          <DialogDescription>
            Die Anfrage bleibt mit ihrer Historie erhalten und kann bei Bedarf
            wieder geöffnet werden.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="Grund" htmlFor="close-reason" required>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as RequestCloseReason)}
                disabled={isLoading}
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
                placeholder="Optionale Ergänzung, z. B. was stattdessen vereinbart wurde..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isLoading}
              />
            </Field>
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
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              Anfrage schließen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
