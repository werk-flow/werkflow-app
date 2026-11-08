'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { withdrawPendingSubmission } from '@/lib/time-tracking/entry-write-actions';
import type { TimeEntry } from '@/lib/time-tracking/types';

// „Zurückziehen“ in the Verlauf: the author of a pending manual submission
// withdraws it before an approver decides.

const WITHDRAW_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  entry_not_pending: 'Über diesen Nachtrag wurde schon entschieden. Die Liste zeigt jetzt den aktuellen Stand.',
  entry_not_found: 'Diesen Nachtrag gibt es nicht mehr. Die Liste zeigt jetzt den aktuellen Stand.',
  not_authorized: 'Nur wer einen Nachtrag eingereicht hat, kann ihn zurückziehen.',
};

/** „Zurückziehen“ on a row: the row shows its spinner until the list carries the change. */
export function useWithdrawSubmission(
  settling: { run: <Result>(id: string, task: () => Promise<Result>) => Promise<Result> },
  refresh: () => Promise<void>,
): { withdraw: (entry: TimeEntry) => void; withdrawError: string | null } {
  const { showBanner } = useBanner();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const withdraw = (entry: TimeEntry) => {
    setWithdrawError(null);
    void settling.run(entry.id, async () => {
      const result = await withdrawPendingSubmission(entry.id);
      if (!result.success) {
        setWithdrawError(
          describeFailure(result, WITHDRAW_FAILURE_MESSAGES, 'Der Nachtrag konnte nicht zurückgezogen werden.'),
        );
        await refresh();
        return;
      }
      showBanner({ variant: 'success', message: 'Dein Nachtrag wurde zurückgezogen.' });
      await refresh();
    });
  };

  return { withdraw, withdrawError };
}
