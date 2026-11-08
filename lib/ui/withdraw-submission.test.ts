import { describe, expect, test } from 'bun:test';
import { withdrawAndReport } from '@/components/zeiterfassung/withdraw-submission';
import type { WithdrawSubmissionResult } from '@/lib/time-tracking/types';

// „Zurückziehen“ in the Verlauf: every outcome reaches the person, and the
// list reads the authoritative state again.

async function report(withdraw: () => Promise<WithdrawSubmissionResult>) {
  const failures: string[] = [];
  const seen = { success: 0, failures, refreshes: 0 };
  await withdrawAndReport({
    withdraw,
    refresh: async () => {
      seen.refreshes += 1;
    },
    onSuccess: () => {
      seen.success += 1;
    },
    onFailure: (sentence) => {
      seen.failures.push(sentence);
    },
  });
  return seen;
}

describe('a withdrawal reports', () => {
  test('a lost request as a failure the person sees, then reads the list again', async () => {
    const seen = await report(() => Promise.reject(new Error('network down')));
    expect(seen).toEqual({
      success: 0,
      failures: ['Der Nachtrag konnte nicht zurückgezogen werden.'],
      refreshes: 1,
    });
  });

  test('a refusal with its sentence', async () => {
    const seen = await report(async () => ({ success: false, error: 'entry_not_pending' }));
    expect(seen.failures).toEqual([
      'Über diesen Nachtrag wurde schon entschieden. Die Liste zeigt jetzt den aktuellen Stand.',
    ]);
    expect(seen.refreshes).toBe(1);
  });

  test('a withdrawn submission with the success banner', async () => {
    const seen = await report(async () => ({ success: true, withdrawn: 2 }));
    expect(seen).toEqual({ success: 1, failures: [], refreshes: 1 });
  });
});
