'use client';

import { useCallback, useState, type FormEvent } from 'react';
import type { useRouter } from 'next/navigation';

import type { challengeDispatch } from '@/lib/dispatch/actions';
import { dispatchErrorMessage, type EmployeeDispatchCard } from '@/lib/dispatch/types';
import { REASON_MIN_8_MESSAGE } from '@/lib/ui/field-validation';

type JobDispatchChallengeOptions = {
  readOnly: boolean;
  refresh: () => Promise<unknown>;
  router: ReturnType<typeof useRouter>;
  runChallenge: typeof challengeDispatch;
};

/** The open challenge ("Rückfrage") of one dispatch card: target, reason and submit. */
export function useJobDispatchChallenge({
  readOnly,
  refresh,
  router,
  runChallenge,
}: JobDispatchChallengeOptions) {
  const [challengeTarget, setChallengeTarget] = useState<EmployeeDispatchCard | null>(null);
  const [challengeReason, setChallengeReason] = useState('');
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const handleChallenge = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (readOnly || !challengeTarget) return;
      if (challengeReason.trim().length < 8) {
        setChallengeError(REASON_MIN_8_MESSAGE);
        document.getElementById('dispatch-challenge-reason')?.focus();
        return;
      }
      setChallengeError(null);
      try {
        const result = await runChallenge(
          challengeTarget.dispatchId,
          challengeTarget.revisionNumber,
          challengeReason,
        );
        if (!result.success) {
          // Shown inside the still-open dialog so the typed reason survives.
          setChallengeError(dispatchErrorMessage(result.error));
          return;
        }
        setChallengeTarget(null);
        setChallengeReason('');
        router.refresh();
        await refresh();
      } catch {
        setChallengeError(dispatchErrorMessage('unexpected_error'));
      }
    },
    [challengeTarget, challengeReason, readOnly, refresh, router, runChallenge],
  );

  function startChallenge(card: EmployeeDispatchCard) {
    setChallengeReason('');
    setChallengeTarget(card);
  }

  function cancelChallenge() {
    setChallengeTarget(null);
    setChallengeError(null);
  }

  return {
    challengeTarget,
    challengeReason,
    setChallengeReason,
    challengeError,
    handleChallenge,
    startChallenge,
    cancelChallenge,
  };
}
