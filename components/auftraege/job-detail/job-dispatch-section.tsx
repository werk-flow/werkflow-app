'use client';

// P1-12: the field worker's own dispatch card on the job detail. One primary
// confirmation action plus a quiet challenge path. Confirming records ONLY
// that this person saw this exact work instruction revision — never
// attendance, time, or a customer promise.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';

import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import { SectionError } from '@/components/ui/section-error';
import { acknowledgeDispatch, challengeDispatch } from '@/lib/dispatch/actions';
import { readInBackground } from '@/lib/data/background-read-client';
import { dispatchErrorMessage, type EmployeeDispatchCard } from '@/lib/dispatch/types';
import type { FieldDispatchState } from '@/lib/dispatch/field-state';
import { JobDispatchCard } from './job-dispatch-card';
import { useJobDispatchChallenge } from './use-job-dispatch-challenge';
import { JobDispatchChallengeDialog } from './job-dispatch-challenge-dialog';
import { SectionTitle } from '@/components/shared/section-title';

type JobDispatchSectionProps = {
  jobId: string;
  initialCards?: EmployeeDispatchCard[] | undefined;
  initialError?: string | null;
  readOnly?: boolean;
  onStateChange?: (state: FieldDispatchState) => void;
};

// The live cards of this job and the load state reported to the parent. The
// background read stays in this file (lib/data/background-read-http.test.ts).
function useJobDispatchCards({
  jobId,
  initialCards,
  initialError,
  onStateChange,
}: {
  jobId: string;
  initialCards: JobDispatchSectionProps['initialCards'];
  initialError: string | null;
  onStateChange: JobDispatchSectionProps['onStateChange'];
}) {
  const view = useLiveView<EmployeeDispatchCard[]>({
    tables: ['planning_dispatches', 'planning_dispatch_recipients', 'planning_dispatch_acknowledgements'],
    read: async ({ signal }): Promise<LiveViewResult<EmployeeDispatchCard[]>> => {
      const result = await readInBackground('job-dispatch-cards', { jobId }, signal);
      return result.success
        ? { ok: true, data: result.cards }
        : { ok: false, error: dispatchErrorMessage(result.error) };
    },
    initialData: initialCards,
    resetKey: jobId,
  });
  const { refresh } = view;
  const cards = view.data ?? null;
  // An initial load failure must stay visible; transient later failures keep
  // last-known cards (the primitive's keep-last-known).
  const loadError =
    view.data !== undefined
      ? null
      : view.isLoading
        ? initialError
        : (view.error ?? dispatchErrorMessage('load_failed'));

  // Latest-callback ref: an inline parent callback must not refire this
  // effect (its own setState would re-render the parent every time).
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({
      status: view.data !== undefined ? 'ready' : view.isLoading && !initialError ? 'loading' : 'error',
      hasPending: view.data?.some((card) => card.myState === 'ausstehend') ?? false,
    });
  }, [view.data, view.isLoading, initialError]);

  return { cards, loadError, refresh, isRefreshing: view.isRefreshing };
}

export function JobDispatchSection({
  jobId,
  initialCards,
  initialError = null,
  readOnly = false,
  onStateChange,
}: JobDispatchSectionProps): ReactElement | null {
  const router = useRouter();
  // The acknowledge failure belongs to the card it was clicked on.
  const [actionError, setActionError] = useState<{
    dispatchId: string;
    message: string;
  } | null>(null);
  const { run: runOnCard, isBusy: isCardBusy } = useBusyIds();
  const { run: runChallenge, isPending: isChallenging } = useServerAction(challengeDispatch);
  const { cards, loadError, refresh, isRefreshing } = useJobDispatchCards({
    jobId,
    initialCards,
    initialError,
    onStateChange,
  });

  const handleAcknowledge = useCallback(
    async (card: EmployeeDispatchCard) => {
      setActionError(null);
      try {
        const result = await runOnCard(card.dispatchId, () =>
          acknowledgeDispatch(card.dispatchId, card.revisionNumber),
        );
        if (!result.success) {
          setActionError({
            dispatchId: card.dispatchId,
            message: dispatchErrorMessage(result.error),
          });
        } else {
          router.refresh();
        }
      } catch {
        setActionError({
          dispatchId: card.dispatchId,
          message: dispatchErrorMessage('unexpected_error'),
        });
      }
      // Re-read either way: a rejected acknowledgement usually means the
      // card itself changed (new revision, withdrawn dispatch).
      await refresh();
    },
    [refresh, router, runOnCard],
  );

  const challenge = useJobDispatchChallenge({
    readOnly,
    refresh,
    router,
    runChallenge,
  });

  // An initial load failure must stay visible instead of silently reading as
  // "kein Einsatz".
  if (loadError) {
    return (
      <section
        className="rounded-lg border bg-card p-4 sm:p-5"
        aria-labelledby="job-dispatch-heading"
        data-testid="job-dispatch-section"
      >
        <SectionTitle id="job-dispatch-heading" icon={<Send className="size-4" />} className="mb-2">
          Mein Einsatz
        </SectionTitle>
        <SectionError onRetry={() => void refresh()} retryPending={isRefreshing}>
          {loadError}
        </SectionError>
      </section>
    );
  }
  if (!cards || cards.length === 0) return null;
  const primaryPendingDispatchId = cards.find((card) => card.myState === 'ausstehend')?.dispatchId;

  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-5"
      aria-labelledby="job-dispatch-heading"
      data-testid="job-dispatch-section"
    >
      <SectionTitle id="job-dispatch-heading" icon={<Send className="size-4" />} className="mb-4">
        Mein Einsatz
      </SectionTitle>
      <div className="space-y-3">
        {cards.map((card) => (
          <JobDispatchCard
            key={card.dispatchId}
            card={card}
            primaryPendingDispatchId={primaryPendingDispatchId}
            readOnly={readOnly}
            isCardBusy={isCardBusy}
            actionError={actionError}
            handleAcknowledge={handleAcknowledge}
            onChallenge={() => challenge.startChallenge(card)}
          />
        ))}
      </div>

      <JobDispatchChallengeDialog
        isOpen={!readOnly && challenge.challengeTarget !== null}
        challengeReason={challenge.challengeReason}
        setChallengeReason={challenge.setChallengeReason}
        challengeError={challenge.challengeError}
        isChallenging={isChallenging}
        handleChallenge={challenge.handleChallenge}
        cancelChallenge={challenge.cancelChallenge}
      />
    </section>
  );
}
