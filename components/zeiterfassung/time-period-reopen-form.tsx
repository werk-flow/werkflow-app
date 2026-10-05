'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { reopenTimePeriod } from '@/lib/time-accounts/actions';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const REASON_FIELD_ID = 'time-period-reopen-reason';

/** Reopens a closed period with a reason (admin only); the refusal stays beside the button. */
export function TimePeriodReopenForm({ periodId }: { periodId: string }) {
  const { showBanner } = useBanner();
  const [reason, setReason] = useState('Korrektur erforderlich');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(reopenTimePeriod);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const nextReasonError = reason.trim()
      ? undefined
      : getTimeAccountFailureMessage('reopen', 'reason_required');
    setReasonError(nextReasonError);
    if (focusFirstInvalidField({ [REASON_FIELD_ID]: nextReasonError })) return;
    const formData = new FormData();
    formData.set('periodId', periodId);
    formData.set('reason', reason);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage('reopen', result.error));
        return;
      }
      showBanner({ variant: 'success', message: 'Der Monat ist wieder geöffnet.' });
    } catch {
      setError(getTimeAccountFailureMessage('reopen', 'reopen_failed'));
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-2" aria-label="Periode wieder öffnen">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Begründung" htmlFor={REASON_FIELD_ID} required error={reasonError}>
          <Input id={REASON_FIELD_ID} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button type="submit" variant="outline" disabled={isPending} aria-busy={isPending || undefined}>
          <InlinePending active={isPending} label="Monat wird wieder geöffnet" />
          Wieder öffnen
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
