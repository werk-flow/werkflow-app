import { describeFailure } from '@/lib/action-messages';
import type { WithdrawSubmissionResult } from '@/lib/time-tracking/types';

// What „Zurückziehen“ reports: the success banner, or the sentence of a
// refusal or a lost request. Either way the list reads the authoritative state
// again, so the row never stays as the click left it.

const WITHDRAW_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  entry_not_pending:
    'Über diesen Nachtrag wurde schon entschieden. Die Liste zeigt jetzt den aktuellen Stand.',
  entry_not_found: 'Diesen Nachtrag gibt es nicht mehr. Die Liste zeigt jetzt den aktuellen Stand.',
  not_authorized: 'Nur wer einen Nachtrag eingereicht hat, kann ihn zurückziehen.',
};

const WITHDRAW_FAILED = 'Der Nachtrag konnte nicht zurückgezogen werden.';

/** Withdraws one submission and reports the outcome; never rejects. */
export async function withdrawAndReport({
  withdraw,
  refresh,
  onSuccess,
  onFailure,
}: {
  withdraw: () => Promise<WithdrawSubmissionResult>;
  refresh: () => Promise<void>;
  onSuccess: () => void;
  onFailure: (sentence: string) => void;
}): Promise<void> {
  try {
    const result = await withdraw();
    if (result.success) onSuccess();
    else onFailure(describeFailure(result, WITHDRAW_FAILURE_MESSAGES, WITHDRAW_FAILED));
  } catch {
    // A lost request is a failure the person sees, never a silent spinner end.
    onFailure(WITHDRAW_FAILED);
  }
  await refresh();
}
