'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { closeTimePeriod } from '@/lib/time-accounts/actions';
import { getClosePeriodFailureMessage } from '@/lib/time-accounts/messages';

/**
 * Closes a prepared period. The database refuses the close while a finding
 * blocks it or a session of the period still runs; the refusal stays beside
 * the button and names the employees whose session runs.
 */
export function TimePeriodCloseForm({ periodId, blocked }: { periodId: string; blocked: boolean }) {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(closeTimePeriod);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set('periodId', periodId);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getClosePeriodFailureMessage(result));
        return;
      }
      showBanner({ variant: 'success', message: 'Der Monat ist abgeschlossen.' });
    } catch {
      setError(getClosePeriodFailureMessage({ success: false, error: 'close_failed' }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Button
        type="submit"
        // eslint-disable-next-line ui/submit-disabled-only-while-pending -- no field to fill: the period cannot close while the findings or running sessions listed above block it
        disabled={blocked || isPending}
        aria-busy={isPending || undefined}
      >
        <InlinePending active={isPending} label="Monat wird abgeschlossen" />
        Monat abschließen
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
