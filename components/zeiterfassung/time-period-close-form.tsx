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
 * Closes a prepared period. The button stays enabled: while the page knows a
 * blocker, a press answers with the blocker sentences instead of a request
 * (werk-flow/werkflow-planning#88). The database refuses the close on its
 * own too; that refusal stays beside the button and names the employees
 * whose session runs.
 */
export function TimePeriodCloseForm({
  periodId,
  blockers,
}: {
  periodId: string;
  /** What still blocks the close, one sentence each; empty when the close may run. */
  blockers: readonly string[];
}) {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const [pressedWhileBlocked, setPressedWhileBlocked] = useState(false);
  const { run, isPending } = useServerAction(closeTimePeriod);
  const blockerText = blockers.join(' ');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (blockers.length > 0) {
      setPressedWhileBlocked(true);
      return;
    }
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
      <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
        <InlinePending active={isPending} label="Monat wird abgeschlossen" />
        Monat abschließen
      </Button>
      {blockerText && pressedWhileBlocked ? <ErrorText>{blockerText}</ErrorText> : null}
      {blockerText && !pressedWhileBlocked ? (
        <p className="text-sm text-muted-foreground" role="status">
          {blockerText}
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
