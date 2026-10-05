'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { MonthPicker } from '@/components/ui/month-picker';
import { useServerAction } from '@/hooks/use-server-action';
import { prepareTimePeriod } from '@/lib/time-accounts/actions';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const MONTH_FIELD_ID = 'time-period-month';

/**
 * Prepares or recalculates a month and opens its detail. The refusal stays
 * beside the button.
 */
export function TimePeriodPrepareForm({ initialMonth }: { initialMonth: string }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [month, setMonth] = useState(initialMonth);
  const [monthError, setMonthError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(prepareTimePeriod);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const nextMonthError = month ? undefined : 'Wähle einen Monat.';
    setMonthError(nextMonthError);
    if (focusFirstInvalidField({ [MONTH_FIELD_ID]: nextMonthError })) return;
    const formData = new FormData();
    formData.set('month', month);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage('prepare', result.error));
        return;
      }
      showBanner({ variant: 'success', message: 'Die Periode ist vorbereitet.' });
      if (result.periodId) router.push(`/zeiterfassung/perioden/${result.periodId}`);
    } catch {
      setError(getTimeAccountFailureMessage('prepare', 'prepare_failed'));
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Monat" htmlFor={MONTH_FIELD_ID} required error={monthError} className="w-40">
          <MonthPicker id={MONTH_FIELD_ID} value={month} onChange={setMonth} />
        </Field>
        <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
          <InlinePending active={isPending} label="Periode wird vorbereitet" />
          Periode vorbereiten
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
