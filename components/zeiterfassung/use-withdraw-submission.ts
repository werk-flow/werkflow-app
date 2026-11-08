'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { withdrawPendingSubmission } from '@/lib/time-tracking/entry-write-actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { withdrawAndReport } from './withdraw-submission';

// „Zurückziehen“ in the Verlauf: the author of a pending manual submission
// withdraws it before an approver decides.

/** „Zurückziehen“ on a row: the row shows its spinner until the list carries the change. */
export function useWithdrawSubmission(
  settling: { run: <Result>(id: string, task: () => Promise<Result>) => Promise<Result> },
  refresh: () => Promise<void>,
): { withdraw: (entry: TimeEntry) => void; withdrawError: string | null } {
  const { showBanner } = useBanner();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const withdraw = (entry: TimeEntry) => {
    setWithdrawError(null);
    void settling.run(entry.id, () =>
      withdrawAndReport({
        withdraw: () => withdrawPendingSubmission(entry.id),
        refresh,
        onSuccess: () => showBanner({ variant: 'success', message: 'Dein Nachtrag wurde zurückgezogen.' }),
        onFailure: setWithdrawError,
      }),
    );
  };

  return { withdraw, withdrawError };
}
