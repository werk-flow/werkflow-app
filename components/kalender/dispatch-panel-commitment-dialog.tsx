'use client';

import { useState } from 'react';

import { useServerAction } from '@/hooks/use-server-action';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import type { DispatchOverviewOccurrence } from '@/lib/dispatch/types';
import { Constants } from '@/lib/supabase/database.types';
import { recordCustomerCommitment } from '@/lib/commitments/actions';
import {
  COMMITMENT_SOURCE_LABELS,
  commitmentErrorMessage,
  type CustomerCommitmentSource,
} from '@/lib/commitments/types';
import { berlinLocalDateOf } from './dispatch-panel-schedule';

type CommitmentDialogState = {
  entry: DispatchOverviewOccurrence;
};

type CommitmentDialogProps = CommitmentDialogState & { onClose: () => void; onSaved: () => void };

/** The commitment's fields, their errors and the save. */
function useCommitmentForm({ entry, onSaved }: CommitmentDialogProps) {
  const [committedDate, setCommittedDate] = useState<Date | undefined>(() => {
    const iso = berlinLocalDateOf(entry);
    const [year, month, day] = iso.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) return undefined;
    return new Date(year, month - 1, day);
  });
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [source, setSource] = useState<CustomerCommitmentSource>('telefonisch');
  const [error, setError] = useState<string | null>(null);
  const { run: runSave, isPending: isSaving } = useServerAction(recordCustomerCommitment);

  const [attempted, setAttempted] = useState(false);
  const fieldErrors = {
    'commitment-date': committedDate ? undefined : 'Bitte wähle den zugesagten Tag.',
    'commitment-window-start':
      windowStart === '' && windowEnd !== '' ? 'Bitte gib auch den Beginn des Zeitfensters an.' : undefined,
    'commitment-window-end':
      windowStart !== '' && windowEnd === '' ? 'Bitte gib auch das Ende des Zeitfensters an.' : undefined,
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(fieldErrors) || !committedDate) return;
    setError(null);
    const dateIso = `${committedDate.getFullYear()}-${String(committedDate.getMonth() + 1).padStart(2, '0')}-${String(committedDate.getDate()).padStart(2, '0')}`;
    try {
      const result = await runSave({
        occurrenceId: entry.occurrenceId,
        committedDate: dateIso,
        windowStartTime: windowStart || null,
        windowEndTime: windowEnd || null,
        source,
        contactId: null,
      });
      if (!result.success) {
        setError(commitmentErrorMessage(result.error));
        return;
      }
      onSaved();
    } catch {
      setError(commitmentErrorMessage('unexpected_error'));
    }
  };

  return {
    committedDate,
    setCommittedDate,
    windowStart,
    setWindowStart,
    windowEnd,
    setWindowEnd,
    source,
    setSource,
    error,
    isSaving,
    attempted,
    fieldErrors,
    handleSave,
  };
}

export function CommitmentDialog(props: CommitmentDialogProps) {
  const { onClose } = props;
  const form = useCommitmentForm(props);
  const { windowStart, windowEnd, source, error, isSaving, attempted, fieldErrors } = form;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Kundenzusage erfassen</DialogTitle>
          <DialogDescription>
            Dokumentiert eine bereits getroffene Vereinbarung mit dem Kunden. Es wird keine Nachricht
            versendet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSave} noValidate className="space-y-4">
          <Field
            label="Zugesagter Tag"
            htmlFor="commitment-date"
            required
            error={attempted ? fieldErrors['commitment-date'] : undefined}
          >
            <DatePicker
              ariaLabel="Zugesagter Tag"
              value={form.committedDate}
              onChange={form.setCommittedDate}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Zeitfenster von (optional)"
              htmlFor="commitment-window-start"
              error={attempted ? fieldErrors['commitment-window-start'] : undefined}
            >
              <TimeInput value={windowStart} onChange={form.setWindowStart} />
            </Field>
            <Field
              label="bis"
              htmlFor="commitment-window-end"
              error={attempted ? fieldErrors['commitment-window-end'] : undefined}
            >
              <TimeInput value={windowEnd} onChange={form.setWindowEnd} />
            </Field>
          </div>
          <Field label="Wie vereinbart?" htmlFor="commitment-source">
            <Select
              value={source}
              onValueChange={(value) => {
                const nextSource = Constants.public.Enums.customer_commitment_source.find(
                  (candidate) => candidate === value,
                );
                if (nextSource) form.setSource(nextSource);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COMMITMENT_SOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              Zusage erfassen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
